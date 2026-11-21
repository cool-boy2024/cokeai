import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import { fulfillOrder } from "@/lib/orders";
import { deriveUsdtAddress } from "./derive";
import { evmBlockNumber, evmListTransfers, evmUnitsToUsdt } from "./evm";
import {
  USDT_NETWORKS,
  isUsdtNetwork,
  networkForProvider,
  providerForNetwork,
  type UsdtNetwork,
} from "./networks";
import {
  getUsdtNetworkSettings,
  getUsdtSettings,
  isUsdtNetworkConfigured,
} from "./settings";
import { sumTransferUnits, verifiedTransfers, type SolidReceipt } from "./tron-receipts";

export { deriveEvmAddress, deriveTronAddress, deriveUsdtAddress, validateEvmXpub, validateUsdtXpub } from "./derive";
export { isUsdtConfigured, configuredUsdtNetworks, isUsdtNetworkConfigured } from "./settings";

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
  scan_from_block?: string | null;
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

export async function isUsdtProviderReady(provider: string): Promise<boolean> {
  const network = networkForProvider(provider);
  return network ? isUsdtNetworkConfigured(network) : false;
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
  network?: UsdtNetwork;
}): Promise<{ deposit: UsdtDeposit; address: string; amountUsdt: number; expiresAt: string }> {
  const network: UsdtNetwork = input.network ?? "trc20";
  const meta = USDT_NETWORKS[network];
  const provider = providerForNetwork(network);
  if (!(await isUsdtNetworkConfigured(network))) throw new Error("USDT 支付尚未配置");
  const settings = await getUsdtNetworkSettings(network);

  const quote = await quoteUsdt(input.amountYuan);
  if (quote.amountUsdt < config.usdtMinAmount) {
    throw new Error(`USDT 单笔最低 ${config.usdtMinAmount} USDT`);
  }

  const expiresAt = new Date(Date.now() + config.usdtQuoteMinutes * 60_000);
  // EVM deposits record the quote block so the scanner never asks the node for
  // an unbounded log range. A small buffer covers a block mined mid-request.
  let scanFromBlock: number | null = null;
  if (meta.kind === "evm") {
    scanFromBlock = Math.max(0, (await evmBlockNumber(network)) - 10);
  }
  const result = await withTransaction(async (client) => {
    // Lock the parent even when no deposit exists yet: concurrent creates
    // must share one address and one locked quote.
    const lockedOrder = await client.query<{ status: string; amount_micros: string; payment_provider: string }>(
      "SELECT status, amount_micros, payment_provider FROM orders WHERE id=$1 FOR UPDATE", [input.orderId],
    );
    const locked = lockedOrder.rows[0];
    if (!locked || locked.status !== "pending" || locked.payment_provider !== provider) throw new Error("订单状态不可支付");
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
    if (existing.rows[0]) {
      const deposit = existing.rows[0];
      const due = new Date(deposit.expires_at).getTime() <= Date.now();
      if (
        due &&
        Number(deposit.received_usdt) === 0 &&
        (deposit.status === "waiting" || deposit.status === "expired")
      ) {
        throw new Error("支付已超时，请重新下单");
      }
      return deposit;
    }

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
    const address = deriveUsdtAddress(network, index, settings.xpub);

    const updated = await client.query(
      `UPDATE orders
          SET payment_provider = $7,
              pay_amount = $2,
              pay_currency = 'USDT',
              pay_address = $3,
              pay_quoted_at = now(),
              pay_expires_at = $4,
              derivation_index = $5,
              payment_meta = jsonb_set(
                jsonb_set(coalesce(payment_meta, '{}'::jsonb), '{usdt_rate}', to_jsonb($6::numeric)),
                '{usdt_network}', to_jsonb($8::text)
              ),
              updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [input.orderId, quote.amountUsdt, address, expiresAt, index, quote.rate, provider, network],
    );
    if (updated.rowCount === 0) throw new Error("订单状态不可支付");

    const inserted = await client.query<UsdtDeposit>(
      `INSERT INTO usdt_deposits
        (order_id, network, address, derivation_index, expected_usdt, expires_at, scan_from_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, order_id, network, address, derivation_index, expected_usdt,
                 received_usdt, txid, block_number, confirmations, status,
                 expires_at, last_checked_at, scan_from_block`,
      [input.orderId, network, address, index, quote.amountUsdt, expiresAt, scanFromBlock],
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

export type ObservedTransfer = {
  txid: string;
  block: number;
  /** Unix seconds of the block that includes the transfer. */
  receivedAt?: number;
};

/**
 * One chain observation for a deposit, shared by the scanners and the
 * last-chance expiry check. Returns the confirmed value received and the
 * newest transfer; `head` is the chain tip used for the confirmation count.
 */
export async function observeDeposit(deposit: {
  network: string;
  address: string;
  scan_from_block?: string | null;
}): Promise<{ received: number; latest?: ObservedTransfer; head: number }> {
  const network: UsdtNetwork = isUsdtNetwork(deposit.network) ? deposit.network : "trc20";
  const meta = USDT_NETWORKS[network];

  if (meta.kind === "tron") {
    const block = await currentTronBlock();
    const transfers = (await listTransfers(deposit.address)).filter(
      (tx) =>
        tx.type === "Transfer" &&
        tx.to === deposit.address &&
        tx.token_info?.address?.trim() === meta.contract &&
        Number(tx.token_info.decimals) === meta.decimals,
    );
    const units = sumTransferUnits(transfers);
    if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("转账金额超出自动核账范围");
    const newest = [...transfers].sort(
      (a, b) => Number(b.block) - Number(a.block),
    )[0];
    return {
      received: Number(units) / 10 ** meta.decimals,
      latest: newest
        ? {
            txid: newest.transaction_id,
            block: Number(newest.block),
            receivedAt: newest.block_timestamp,
          }
        : undefined,
      head: block,
    };
  }

  const listed = await evmListTransfers({
    network,
    address: deposit.address,
    fromBlock: deposit.scan_from_block ? Number(deposit.scan_from_block) : null,
  });
  const units = listed.transfers.reduce((sum, tx) => sum + tx.units, 0n);
  const newest = [...listed.transfers].sort((a, b) => b.block - a.block)[0];
  return {
    received: evmUnitsToUsdt(units, meta.decimals),
    latest: newest
      ? { txid: newest.txid, block: newest.block, receivedAt: newest.timestamp }
      : undefined,
    head: listed.latestBlock,
  };
}

/**
 * Checks the chain once immediately before an expiry cancellation. A payment
 * broadcast just before the deadline must never be lost because the five
 * minute scanner has not observed it yet. "unknown" means the chain query
 * failed; in that case the order is left pending for the next scan.
 */
async function checkDepositBeforeExpiry(deposit: {
  id: string;
  order_id: string;
  network: string;
  address: string;
  expected_usdt: string;
  status: UsdtDepositStatus;
  expires_at: string;
  scan_from_block?: string | null;
}): Promise<"clear" | "funded" | "unknown"> {
  try {
    const network: UsdtNetwork = isUsdtNetwork(deposit.network) ? deposit.network : "trc20";
    const { received, latest, head } = await observeDeposit(deposit);
    if (received <= 0) return "clear";

    const confirmations = latest ? Math.max(0, head - latest.block) : 0;
    const evaluation = evaluateUsdtDeposit({
      currentStatus: deposit.status,
      expectedUsdt: toNumber(deposit.expected_usdt),
      receivedUsdt: received,
      confirmations,
      requiredConfirmations: USDT_NETWORKS[network].requiredConfirmations,
      expiresAt: deposit.expires_at,
      receivedAt: latest?.receivedAt,
      toleranceUsdt: amountToleranceUsdt(toNumber(deposit.expected_usdt)),
    });
    await query(
      `UPDATE usdt_deposits
          SET received_usdt = $2,
              txid = COALESCE($3, txid),
              block_number = COALESCE($4, block_number),
              confirmations = $5,
              status = $6,
              last_checked_at = now(),
              updated_at = now()
        WHERE id = $1
          AND status IN ('waiting', 'partial', 'confirming', 'expired')`,
      [
        deposit.id,
        received,
        latest?.txid || null,
        latest?.block ?? null,
        confirmations,
        evaluation.status,
      ],
    );
    return "funded";
  } catch (error) {
    console.error(
      "[usdt-expire] chain check failed",
      deposit.order_id,
      error instanceof Error ? error.message : error,
    );
    return "unknown";
  }
}

async function cancelExpiredUsdtOrder(
  orderId: string,
  userId?: string,
): Promise<boolean> {
  const values: string[] = [orderId];
  const userClause = userId ? "AND o.user_id = $2" : "";
  if (userId) values.push(userId);
  const result = await query<{ id: string }>(
    `UPDATE orders o
        SET status = 'cancelled', updated_at = now()
      WHERE o.id = $1
        ${userClause}
        AND o.status = 'pending'
        AND o.payment_provider IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
        AND o.pay_txid IS NULL
        AND o.pay_expires_at IS NOT NULL
        AND o.pay_expires_at <= now()
        AND NOT EXISTS (
          SELECT 1
            FROM usdt_deposits d
           WHERE d.order_id = o.id
             AND (
               d.received_usdt > 0
               OR d.status IN ('confirming', 'confirmed', 'overpaid', 'manual')
             )
        )
      RETURNING o.id`,
    values,
  );
  if (!result.rows[0]) return false;
  await query(
    `UPDATE usdt_deposits
        SET status = 'expired', updated_at = now()
      WHERE order_id = $1 AND status IN ('waiting', 'expired')`,
    [orderId],
  );
  return true;
}

/** Expire one user's USDT order after a final on-chain check. */
export async function expireUsdtOrderForUser(
  orderId: string,
  userId: string,
): Promise<boolean> {
  const result = await query<{
    deposit_id: string | null;
    network: string | null;
    address: string | null;
    expected_usdt: string | null;
    received_usdt: string | null;
    deposit_status: UsdtDepositStatus | null;
    deposit_expires_at: string | null;
    confirmations: number | null;
    scan_from_block: string | null;
  }>(
    `SELECT d.id AS deposit_id, d.network, d.address, d.expected_usdt,
            d.received_usdt, d.status AS deposit_status,
            d.expires_at AS deposit_expires_at, d.confirmations,
            d.scan_from_block
       FROM orders o
       LEFT JOIN usdt_deposits d ON d.order_id = o.id
      WHERE o.id = $1
        AND o.user_id = $2
        AND o.status = 'pending'
        AND o.payment_provider IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
        AND o.pay_expires_at IS NOT NULL
        AND o.pay_expires_at <= now()
      LIMIT 1`,
    [orderId, userId],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (
    Number(row.received_usdt || 0) > 0 ||
    (row.deposit_status &&
      ["confirming", "confirmed", "overpaid", "manual"].includes(row.deposit_status))
  ) {
    return false;
  }
  if (row.deposit_id && row.address && row.expected_usdt) {
    const check = await checkDepositBeforeExpiry({
      id: row.deposit_id,
      order_id: orderId,
      network: row.network || "trc20",
      address: row.address,
      expected_usdt: row.expected_usdt,
      status: row.deposit_status || "waiting",
      expires_at: row.deposit_expires_at || new Date().toISOString(),
      scan_from_block: row.scan_from_block,
    });
    if (check !== "clear") return false;
  }
  return cancelExpiredUsdtOrder(orderId, userId);
}

/**
 * Cron fallback for orders whose payment page is closed. The scanner runs
 * before this function, so an observed transfer is excluded by the SQL guard.
 */
export async function expireUnpaidUsdtOrders(limit = 100): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE orders o
        SET status = 'cancelled', updated_at = now()
      WHERE o.id IN (
        SELECT candidate.id
          FROM orders candidate
         WHERE candidate.status = 'pending'
           AND candidate.payment_provider IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
           AND candidate.pay_txid IS NULL
           AND candidate.pay_expires_at IS NOT NULL
           AND candidate.pay_expires_at <= now()
           AND NOT EXISTS (
             SELECT 1
               FROM usdt_deposits d
              WHERE d.order_id = candidate.id
                AND (
                  d.received_usdt > 0
                  OR d.status IN ('confirming', 'confirmed', 'overpaid', 'manual')
                )
           )
           -- Only cancel after a successful chain scan explicitly marked the
           -- deposit expired. A TronGrid outage leaves the order pending.
           AND (
             NOT EXISTS (
               SELECT 1 FROM usdt_deposits d WHERE d.order_id = candidate.id
             )
             OR EXISTS (
               SELECT 1
                 FROM usdt_deposits d
                WHERE d.order_id = candidate.id
                  AND d.status = 'expired'
                  AND d.received_usdt = 0
             )
           )
         ORDER BY candidate.pay_expires_at
         LIMIT $1
      )
      RETURNING o.id`,
    [limit],
  );
  if (!result.rows[0]) return 0;
  await query(
    `UPDATE usdt_deposits d
        SET status = 'expired', updated_at = now()
       FROM orders o
      WHERE d.order_id = o.id
        AND o.id = ANY($1::uuid[])
        AND d.status IN ('waiting', 'expired')`,
    [result.rows.map((row) => row.id)],
  );
  return result.rowCount || 0;
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
  // Exchange fees shave a fraction off the quoted amount. Callers pass the
  // operator tolerance (bps / flat USDT). Omit it and the quote must be exact.
  const tolerance = round6(Math.max(0, input.toleranceUsdt ?? 0));
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
            d.confirmations, d.status, d.expires_at, d.last_checked_at,
            d.scan_from_block
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

  const usdtSettings = await getUsdtSettings();
  // Keyless TronGrid is fine for a first small test, but pace requests far
  // slower so the public endpoint does not rate-limit the whole scan.
  const throttleMs = usdtSettings.usdtTronGridApiKey ? 200 : 1_200;
  let credited = 0;
  let partial = 0;
  let errors = 0;

  for (const deposit of result.rows) {
    try {
      const network: UsdtNetwork = isUsdtNetwork(deposit.network) ? deposit.network : "trc20";
      // A failing chain must not stop deposits on the other chains: each
      // observation is caught per row below.
      const { received, latest, head } = await observeDeposit(deposit);
      const expected = toNumber(deposit.expected_usdt);
      const confirmations = latest ? Math.max(0, head - latest.block) : 0;

      const evaluation = evaluateUsdtDeposit({
        currentStatus: deposit.status,
        expectedUsdt: expected,
        receivedUsdt: received,
        confirmations,
        requiredConfirmations: USDT_NETWORKS[network].requiredConfirmations,
        expiresAt: deposit.expires_at,
        receivedAt: latest?.receivedAt,
        toleranceUsdt: amountToleranceUsdt(expected),
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
          latest?.txid || null,
          latest?.block ?? null,
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
