import { HDKey } from "@scure/bip32";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import bs58check from "bs58check";
import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import { fulfillOrder } from "@/lib/orders";
import { getUsdtSettings } from "./settings";
import { sumTransferUnits, verifiedTransfers, type SolidReceipt } from "./tron-receipts";

export type UsdtDepositStatus =
  | "waiting"
  | "partial"
  | "confirming"
  | "confirmed"
  | "overpaid"
  | "expired"
  | "manual";

export type UsdtDeposit = {
  id: string;
  order_id: string;
  network: string;
  address: string;
  derivation_index: number;
  expected_usdt: string;
  received_usdt: string;
  txid: string | null;
  block_number: string | null;
  confirmations: number;
  status: UsdtDepositStatus;
  expires_at: string;
  last_checked_at: string | null;
};

export type TronGridTransfer = {
  transaction_id: string;
  block: number | string;
  block_timestamp?: number;
  log_index?: number;
  from: string;
  to: string;
  type: string;
  value: string | number;
  token_info?: {
    address: string;
    decimals: number;
    symbol: string;
    name: string;
  };
};

type TronGridResponse =
  | { data?: TronGridTransfer[]; success?: boolean }
  | TronGridTransfer[];

export async function isUsdtConfigured(): Promise<boolean> {
  const settings = await getUsdtSettings();
  // TronGrid allows low-volume keyless queries. A key is strongly recommended
  // for production, but requiring one would block a first small test.
  if (!settings.usdtEnabled || !settings.usdtXpub) return false;
  try { validateUsdtXpub(settings.usdtXpub); return true; } catch { return false; }
}

export function validateUsdtXpub(xpub: string): void {
  if (!/^xpub[1-9A-HJ-NP-Za-km-z]{100,115}$/.test(xpub)) throw new Error("请输入账户扩展公钥 xpub");
  const account = HDKey.fromExtendedKey(xpub);
  if (account.privateKey || account.depth !== 3 || account.index !== 0x80000000) throw new Error("xpub 须为 m/44'/195'/0' 的账户公钥");
}

export function deriveTronAddress(index: number, xpub: string = config.usdtXpub): string {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error("USDT 派生索引无效");
  }
  validateUsdtXpub(xpub);
  // The configured account xpub is m/44'/195'/0'; deposit addresses live at
  // .../0/index (external chain), matching scripts/generate-trc20-wallet.mjs.
  const account = HDKey.fromExtendedKey(xpub);
  const child = account.deriveChild(0).deriveChild(index);
  if (!child.publicKey) throw new Error("无法派生收款地址");
  const uncompressed = secp256k1.Point.fromHex(
    Buffer.from(child.publicKey).toString("hex"),
  ).toBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const body = new Uint8Array(21);
  body[0] = 0x41; // Tron mainnet address version
  body.set(hash.slice(-20), 1);
  return bs58check.encode(body);
}

let cachedRate: { value: number; expiresAt: number } | null = null;

export async function getUsdtCnyRate(): Promise<number> {
  if (cachedRate && cachedRate.expiresAt > Date.now()) return cachedRate.value;
  try {
    const response = await fetch(config.usdtRateUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        tether?: { cny?: number };
      };
      const rate = Number(payload.tether?.cny);
      if (Number.isFinite(rate) && rate > 0) {
        cachedRate = { value: rate, expiresAt: Date.now() + 15 * 60_000 };
        return rate;
      }
    }
  } catch {
    // Fall back to the configured rate.
  }
  // A stale or implicit default rate must never undercharge a live order.
  if (process.env.USDT_CNY_RATE && Number.isFinite(config.usdtCnyRate) && config.usdtCnyRate > 0) return config.usdtCnyRate;
  throw new Error("暂时无法获取 USDT 报价，请稍后重试");
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * CNY amount -> USDT amount at an explicit market rate. Buffer covers FX
 * movement and chain rounding.
 */
export function quoteUsdtAtRate(amountYuan: number, marketRate: number): {
  amountUsdt: number;
  rate: number;
} {
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
    throw new Error("订单金额无效");
  }
  if (!Number.isFinite(marketRate) || marketRate <= 0) {
    throw new Error("USDT 汇率无效");
  }
  const buffer = config.usdtCnyRateBufferBps;
  if (!Number.isInteger(buffer) || buffer < 0 || buffer >= 10_000) throw new Error("USDT 汇率缓冲无效");
  const rate = marketRate * (1 - buffer / 10_000);
  const amountMicros = Math.round(amountYuan * 1_000_000);
  const rateMicros = Math.floor(rate * 1_000_000);
  if (!Number.isSafeInteger(amountMicros) || !Number.isSafeInteger(rateMicros) || rateMicros <= 0) throw new Error("USDT 报价超出范围");
  // Round UP in cents of USDT; no binary floating-point money comparison.
  const cents = (BigInt(amountMicros) * 100n + BigInt(rateMicros) - 1n) / BigInt(rateMicros);
  const amountUsdt = Number(cents) / 100;
  return { amountUsdt, rate };
}

export async function quoteUsdt(amountYuan: number): Promise<{
  amountUsdt: number;
  rate: number;
}> {
  const marketRate = await getUsdtCnyRate();
  return quoteUsdtAtRate(amountYuan, marketRate);
}

export async function createUsdtDeposit(input: {
  orderId: string;
  amountYuan: number;
}): Promise<{ deposit: UsdtDeposit; address: string; amountUsdt: number; expiresAt: string }> {
  const settings = await getUsdtSettings();
  if (!(await isUsdtConfigured())) throw new Error("USDT 支付尚未配置");

  const quote = await quoteUsdt(input.amountYuan);
  if (quote.amountUsdt < config.usdtMinAmount) {
    throw new Error(`USDT 单笔最低 ${config.usdtMinAmount} USDT`);
  }

  const expiresAt = new Date(Date.now() + config.usdtQuoteMinutes * 60_000);
  const result = await withTransaction(async (client) => {
    // Lock the parent even when no deposit exists yet: concurrent creates
    // must share one address and one locked quote.
    const lockedOrder = await client.query<{ status: string; amount_micros: string; payment_provider: string }>(
      "SELECT status, amount_micros, payment_provider FROM orders WHERE id=$1 FOR UPDATE", [input.orderId],
    );
    const locked = lockedOrder.rows[0];
    if (!locked || locked.status !== "pending" || locked.payment_provider !== "usdt_trc20") throw new Error("订单状态不可支付");
    if (BigInt(locked.amount_micros) !== BigInt(Math.round(input.amountYuan * 1_000_000))) throw new Error("订单金额不一致");
    // Reuse the existing quote when the user refreshes the payment page. This
    // keeps the address stable and avoids burning derivation indexes.
    const existing = await client.query<UsdtDeposit>(
      `SELECT id, order_id, network, address, derivation_index, expected_usdt,
              received_usdt, txid, block_number, confirmations, status,
              expires_at, last_checked_at
         FROM usdt_deposits
        WHERE order_id = $1
        FOR UPDATE`,
      [input.orderId],
    );
    if (existing.rows[0]) return existing.rows[0];

    const order = await client.query<{ status: string }>(
      "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
      [input.orderId],
    );
    if (!order.rows[0]) throw new Error("订单不存在");
    if (order.rows[0].status !== "pending") throw new Error("订单状态不可支付");

    const seq = await client.query<{ index: string }>(
      "SELECT nextval('usdt_derivation_seq')::text AS index",
    );
    const index = Number(seq.rows[0].index);
    const address = deriveTronAddress(index, settings.usdtXpub);

    const updated = await client.query(
      `UPDATE orders
          SET payment_provider = 'usdt_trc20',
              pay_amount = $2,
              pay_currency = 'USDT',
              pay_address = $3,
              pay_quoted_at = now(),
              pay_expires_at = $4,
              derivation_index = $5,
              payment_meta = jsonb_set(coalesce(payment_meta, '{}'::jsonb), '{usdt_rate}', to_jsonb($6::numeric)),
              updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [input.orderId, quote.amountUsdt, address, expiresAt, index, quote.rate],
    );
    if (updated.rowCount === 0) throw new Error("订单状态不可支付");

    const inserted = await client.query<UsdtDeposit>(
      `INSERT INTO usdt_deposits
        (order_id, address, derivation_index, expected_usdt, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, order_id, network, address, derivation_index, expected_usdt,
                 received_usdt, txid, block_number, confirmations, status,
                 expires_at, last_checked_at`,
      [input.orderId, address, index, quote.amountUsdt, expiresAt],
    );
    return inserted.rows[0];
  });

  return {
    deposit: result,
    address: result.address,
    amountUsdt: toNumber(result.expected_usdt),
    expiresAt: result.expires_at,
  };
}

export async function getUsdtDepositForOrder(orderId: string): Promise<UsdtDeposit | null> {
  const result = await query<UsdtDeposit>(
    `SELECT id, order_id, network, address, derivation_index, expected_usdt,
            received_usdt, txid, block_number, confirmations, status,
            expires_at, last_checked_at
       FROM usdt_deposits
      WHERE order_id = $1
      LIMIT 1`,
    [orderId],
  );
  return result.rows[0] || null;
}

export async function currentTronBlock(): Promise<number> {
  const config = await getUsdtSettings();
  const response = await fetch(`${config.usdtTronGridUrl}/wallet/getnowblock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.usdtTronGridApiKey
        ? { "TRON-PRO-API-KEY": config.usdtTronGridApiKey }
        : {}),
    },
    body: "{}",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`TronGrid block query failed: ${response.status}`);
  const payload = (await response.json()) as {
    block_header?: { raw_data?: { number?: number } };
  };
  const block = Number(payload.block_header?.raw_data?.number);
  if (!Number.isFinite(block)) throw new Error("TronGrid returned no block number");
  return block;
}

export async function listTransfers(address: string): Promise<TronGridTransfer[]> {
  const settings = await getUsdtSettings();
  const headers = { "Content-Type": "application/json", ...(settings.usdtTronGridApiKey ? { "TRON-PRO-API-KEY": settings.usdtTronGridApiKey } : {}) };
  const url = new URL(`${settings.usdtTronGridUrl}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`);
  url.searchParams.set("limit", "200");
  url.searchParams.set("contract_address", settings.usdtContract);
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("only_to", "true");
  const ids = new Set<string>();
  let complete = false;
  const fingerprints = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`TronGrid 查询失败 (${response.status})`);
    const body = await response.json() as { success?: boolean; data?: TronGridTransfer[]; meta?: { fingerprint?: string } };
    if (body.success !== true || !Array.isArray(body.data)) throw new Error("TronGrid 返回异常");
    for (const tx of body.data) {
      if (tx.to === address && tx.type === "Transfer" && tx.token_info?.address === settings.usdtContract && Number(tx.token_info.decimals) === 6 && /^[a-f0-9]{64}$/i.test(tx.transaction_id)) ids.add(tx.transaction_id);
    }
    const fingerprint = body.meta?.fingerprint;
    if (!fingerprint || body.data.length === 0) { complete = true; break; }
    if (fingerprints.has(fingerprint)) throw new Error("TronGrid 分页异常");
    fingerprints.add(fingerprint);
    url.searchParams.set("fingerprint", fingerprint);
  }
  if (!complete) throw new Error("地址交易过多，请人工对账");
  const verified: TronGridTransfer[] = [];
  for (const id of ids) {
    const response = await fetch(`${settings.usdtTronGridUrl}/walletsolidity/gettransactioninfobyid`, { method: "POST", headers, body: JSON.stringify({ value: id }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`TronGrid 确认查询失败 (${response.status})`);
    const receipt = await response.json() as SolidReceipt & { Error?: string };
    if (receipt.Error) throw new Error("TronGrid 确认查询异常");
    verified.push(...verifiedTransfers(receipt, id, address, settings.usdtContract));
  }
  return verified;
}

export function transferAmountUsdt(transfer: TronGridTransfer): number {
  const decimals = Number(transfer.token_info?.decimals ?? 6);
  const raw = Number(transfer.value || 0);
  if (!Number.isFinite(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
  return round6(raw / 10 ** decimals);
}

export function amountToleranceUsdt(expectedUsdt: number): number {
  return round6(
    Math.max(
      0,
      config.usdtAmountToleranceUsdt,
      expectedUsdt * (config.usdtUnderpayToleranceBps / 10_000),
    ),
  );
}

export type UsdtEvaluation = {
  status: UsdtDepositStatus;
  enough: boolean;
  overpaid: boolean;
  expired: boolean;
};

/**
 * Pure status machine for a deposit. Kept separate from TronGrid so the
 * under/over/late/confirmation rules are testable without chain calls.
 *
 * Rules:
 * - Less than the locked quote => partial; no implicit discount.
 * - Enough value => confirming until required confirmations, then confirmed.
 * - More than expected + tolerance => overpaid (still credits the order once).
 * - Payment after quote expiry => manual review; delayed observation of an on-time transfer is accepted.
 * - Zero payment expires at the quote deadline.
 */
export function evaluateUsdtDeposit(input: {
  currentStatus: UsdtDepositStatus;
  expectedUsdt: number;
  receivedUsdt: number;
  confirmations: number;
  requiredConfirmations: number;
  expiresAt: string | Date;
  now?: number;
  graceHours?: number;
  toleranceUsdt?: number;
  receivedAt?: number;
}): UsdtEvaluation {
  const now = input.now ?? Date.now();
  const expiresAt = new Date(input.expiresAt).getTime();

  const expected = round6(Math.max(0, input.expectedUsdt));
  const received = round6(Math.max(0, input.receivedUsdt));
  // Collect the full quote: underpayments never become successful orders.
  const tolerance = 0;
  const enough = expected > 0 && received + tolerance >= expected;
  const overpaid = enough && received > expected + tolerance;
  const pastExpiry = Number.isFinite(expiresAt) && now > expiresAt;
  if (!Number.isFinite(expiresAt) || !Number.isFinite(input.confirmations) || !Number.isFinite(input.requiredConfirmations) || input.requiredConfirmations < 1) return { status: "manual", enough: false, overpaid: false, expired: true };
  const paidLate = received > 0 && (input.receivedAt ?? now) > expiresAt;
  if (input.currentStatus === "manual" || paidLate) return { status: "manual", enough, overpaid, expired: pastExpiry };

  if (enough) {
    if (input.confirmations < input.requiredConfirmations) {
      return { status: "confirming", enough, overpaid, expired: pastExpiry };
    }
    return {
      status: overpaid ? "overpaid" : "confirmed",
      enough,
      overpaid,
      expired: pastExpiry,
    };
  }

  if (received > 0) {
    return { status: "partial", enough, overpaid: false, expired: pastExpiry };
  }

  if (pastExpiry) {
    return { status: "expired", enough, overpaid: false, expired: true };
  }
  return { status: "waiting", enough, overpaid: false, expired: false };
}

export async function scanUsdtDeposits(limit = 50): Promise<{
  checked: number;
  credited: number;
  partial: number;
  errors: number;
}> {
  // Disabling new quotes must not abandon addresses already given to customers.

  // Keep checking expired quotes so late funds enter manual reconciliation.
  const result = await query<UsdtDeposit>(
    `SELECT d.id, d.order_id, d.network, d.address, d.derivation_index,
            d.expected_usdt, d.received_usdt, d.txid, d.block_number,
            d.confirmations, d.status, d.expires_at, d.last_checked_at
       FROM usdt_deposits d
       JOIN orders o ON o.id = d.order_id
      WHERE d.status IN ('waiting', 'partial', 'confirming', 'expired')
        AND o.status = 'pending'
      ORDER BY d.last_checked_at NULLS FIRST, d.created_at
      LIMIT $1`,
    [limit],
  );

  if (result.rows.length === 0) {
    return { checked: 0, credited: 0, partial: 0, errors: 0 };
  }

  let block = 0;
  try {
    block = await currentTronBlock();
  } catch (error) {
    console.error("[usdt] block query failed", error instanceof Error ? error.message : error);
    return { checked: result.rows.length, credited: 0, partial: 0, errors: 1 };
  }

  const contract = config.usdtContract.trim();
  const usdtSettings = await getUsdtSettings();
  // Keyless TronGrid is fine for a first small test, but pace requests far
  // slower so the public endpoint does not rate-limit the whole scan.
  const throttleMs = usdtSettings.usdtTronGridApiKey ? 200 : 1_200;
  let credited = 0;
  let partial = 0;
  let errors = 0;

  for (const deposit of result.rows) {
    try {
      const transfers = (await listTransfers(deposit.address)).filter(
        (tx) =>
          tx.type === "Transfer" &&
          tx.to === deposit.address &&
          tx.token_info?.address?.trim() === contract,
      );

      const units = sumTransferUnits(transfers);
      if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("转账金额超出自动核账范围");
      const received = Number(units) / 1_000_000;
      const expected = toNumber(deposit.expected_usdt);
      const latest = [...transfers].sort(
        (a, b) => Number(b.block) - Number(a.block),
      )[0];
      const confirmations = latest
        ? Math.max(0, block - Number(latest.block))
        : 0;

      const evaluation = evaluateUsdtDeposit({
        currentStatus: deposit.status,
        expectedUsdt: expected,
        receivedUsdt: received,
        confirmations,
        requiredConfirmations: config.usdtConfirmations,
        expiresAt: deposit.expires_at,
        receivedAt: latest?.block_timestamp,
      });

      // Atomic claim: only the worker that transitions the row out of a
      // non-final state may fulfill the order. A racing scan updates zero rows
      // after the first commit and therefore skips the credit path.
      const updated = await query<{ status: string }>(
        `UPDATE usdt_deposits
            SET received_usdt = $2,
                txid = coalesce($3, txid),
                block_number = coalesce($4, block_number),
                confirmations = $5,
                status = $6,
                last_checked_at = now(),
                updated_at = now()
          WHERE id = $1
            AND status IN ('waiting', 'partial', 'confirming', 'expired')
          RETURNING status`,
        [
          deposit.id,
          received,
          latest?.transaction_id || null,
          latest ? Number(latest.block) : null,
          confirmations,
          evaluation.status,
        ],
      );

      if (!updated.rows[0]) continue;

      if (evaluation.status === "confirmed" || evaluation.status === "overpaid") {
        try {
          const fulfilled = await fulfillOrder(deposit.order_id);
          if (fulfilled.creditStatus === "failed") errors += 1;
          else credited += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (message.includes("订单状态不可完成")) {
            // The order was cancelled while the payment was in flight. Never
            // credit it automatically; leave it for manual reconciliation.
            await query(
              `UPDATE usdt_deposits
                  SET status = 'manual', last_checked_at = now(), updated_at = now()
                WHERE id = $1`,
              [deposit.id],
            );
            console.error("[usdt] payment for non-pending order", deposit.order_id);
          } else {
            errors += 1;
            throw error;
          }
        }
      } else if (evaluation.status === "partial") {
        partial += 1;
      }
    } catch (error) {
      errors += 1;
      console.error(
        "[usdt] scan failed",
        deposit.order_id,
        error instanceof Error ? error.message : error,
      );
      await query(
        "UPDATE usdt_deposits SET last_checked_at = now(), updated_at = now() WHERE id = $1",
        [deposit.id],
      );
    } finally {
      // Stay under TronGrid's quota on small keys and the public endpoint.
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }

  // A deposit can be confirmed while the order is still pending if a previous
  // fulfillment attempt crashed before committing. Retry those idempotently.
  const stuck = await query<{ order_id: string }>(
    `SELECT d.order_id
       FROM usdt_deposits d
       JOIN orders o ON o.id = d.order_id
      WHERE d.status IN ('confirmed', 'overpaid')
        AND o.status = 'pending'
      ORDER BY d.updated_at
      LIMIT 20`,
  );
  for (const row of stuck.rows) {
    try {
      const fulfilled = await fulfillOrder(row.order_id);
      if (fulfilled.creditStatus === "failed") errors += 1;
      else credited += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("订单状态不可完成")) {
        await query(
          `UPDATE usdt_deposits
              SET status = 'manual', last_checked_at = now(), updated_at = now()
            WHERE order_id = $1 AND status IN ('confirmed', 'overpaid')`,
          [row.order_id],
        );
      } else {
        errors += 1;
        console.error("[usdt] confirmed order retry failed", row.order_id, message);
      }
    }
  }

  return { checked: result.rows.length, credited, partial, errors };
}
