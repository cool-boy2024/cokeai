import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import {
  amountToleranceUsdt,
  deriveUsdtAddress,
  evaluateUsdtDeposit,
  isUsdtConfigured,
  isUsdtNetworkConfigured,
  observeDeposit,
  quoteUsdt,
  type UsdtDepositStatus,
} from "@/lib/payments/usdt";
import { evmBlockNumber } from "@/lib/payments/evm";
import {
  USDT_NETWORKS,
  isUsdtNetwork,
  providerForNetwork,
  type UsdtNetwork,
} from "@/lib/payments/networks";
import { getUsdtNetworkSettings, getUsdtSettings } from "@/lib/payments/settings";
import { notifyShopOrderPaid } from "./notify";
import { markShopOrderPaid } from "./orders";

export type ShopUsdtDeposit = {
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

export async function isShopUsdtAvailable(): Promise<boolean> {
  return isUsdtConfigured();
}

export async function createShopUsdtDeposit(input: {
  orderId: string;
  amountMicros: number;
  network?: UsdtNetwork;
}): Promise<ShopUsdtDeposit> {
  const network: UsdtNetwork = input.network ?? "trc20";
  const meta = USDT_NETWORKS[network];
  const provider = providerForNetwork(network);
  if (!(await isUsdtNetworkConfigured(network))) throw new Error("USDT 支付尚未配置");

  const amountYuan = input.amountMicros / 1_000_000;
  const settings = await getUsdtNetworkSettings(network);
  const quote = await quoteUsdt(amountYuan);
  if (quote.amountUsdt < config.usdtMinAmount) {
    throw new Error(`USDT 单笔最低 ${config.usdtMinAmount} USDT`);
  }

  const quoteExpires = new Date(Date.now() + config.usdtQuoteMinutes * 60_000);
  // A USDT quote and its shop order share one deadline. The customer promised
  // ten minutes must not have a hidden 24 hour payment window behind it.
  const orderExpires = quoteExpires;
  let scanFromBlock: number | null = null;
  if (meta.kind === "evm") {
    scanFromBlock = Math.max(0, (await evmBlockNumber(network)) - 10);
  }

  return withTransaction(async (client) => {
    const order = await client.query<{ status: string; amount_micros: string | number; payment_provider: string }>(
      `SELECT status, amount_micros, payment_provider FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const row = order.rows[0];
    if (!row) throw new Error("订单不存在");
    if (row.status !== "pending_payment") throw new Error("订单状态不可支付");
    if (toNumber(row.amount_micros) !== input.amountMicros) throw new Error("订单金额变化，请刷新");
    if (row.payment_provider !== provider) throw new Error("支付网络与订单不一致，请重新下单");

    const existing = await client.query<ShopUsdtDeposit>(
      `SELECT id, order_id, network, address, derivation_index, expected_usdt,
              received_usdt, txid, block_number, confirmations, status,
              expires_at, last_checked_at, scan_from_block
         FROM shop_usdt_deposits
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

    const seq = await client.query<{ index: string }>(
      "SELECT nextval('usdt_derivation_seq')::text AS index",
    );
    const index = Number(seq.rows[0].index);
    const address = deriveUsdtAddress(network, index, settings.xpub);

    await client.query(
      `UPDATE shop_orders
          SET payment_provider = $7,
              pay_amount = $2,
              pay_currency = 'USDT',
              pay_address = $3,
              pay_quoted_at = now(),
              pay_expires_at = $4,
              derivation_index = $5,
              expires_at = $6,
              updated_at = now()
        WHERE id = $1 AND status = 'pending_payment'`,
      [input.orderId, quote.amountUsdt, address, quoteExpires, index, orderExpires, provider],
    );

    const inserted = await client.query<ShopUsdtDeposit>(
      `INSERT INTO shop_usdt_deposits
         (order_id, network, address, derivation_index, expected_usdt, expires_at, scan_from_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, order_id, network, address, derivation_index, expected_usdt,
                 received_usdt, txid, block_number, confirmations, status,
                 expires_at, last_checked_at, scan_from_block`,
      [input.orderId, network, address, index, quote.amountUsdt, quoteExpires, scanFromBlock],
    );
    return inserted.rows[0];
  });
}

export async function getShopUsdtDeposit(orderId: string): Promise<ShopUsdtDeposit | null> {
  const result = await query<ShopUsdtDeposit>(
    `SELECT id, order_id, network, address, derivation_index, expected_usdt,
            received_usdt, txid, block_number, confirmations, status,
            expires_at, last_checked_at, scan_from_block
       FROM shop_usdt_deposits
      WHERE order_id = $1
      LIMIT 1`,
    [orderId],
  );
  return result.rows[0] || null;
}

/**
 * Final on-chain check before a shop USDT order is cancelled at the deadline.
 * Prevents an in-flight transfer from being lost between scanner runs.
 */
async function checkShopDepositBeforeExpiry(
  deposit: ShopUsdtDeposit,
): Promise<"clear" | "funded" | "unknown"> {
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
    });
    await query(
      `UPDATE shop_usdt_deposits
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
      "[shop-usdt-expire] chain check failed",
      deposit.order_id,
      error instanceof Error ? error.message : error,
    );
    return "unknown";
  }
}

/** Cancel one user's shop USDT order after the ten minute quote expires. */
export async function expireShopUsdtOrderForUser(
  orderId: string,
  userId: string,
): Promise<boolean> {
  const result = await query<ShopUsdtDeposit>(
    `SELECT d.id, d.order_id, d.network, d.address, d.derivation_index,
            d.expected_usdt, d.received_usdt, d.txid, d.block_number,
            d.confirmations, d.status, d.expires_at, d.last_checked_at,
            d.scan_from_block
       FROM shop_orders o
       LEFT JOIN shop_usdt_deposits d ON d.order_id = o.id
      WHERE o.id = $1
        AND o.user_id = $2
        AND o.status = 'pending_payment'
        AND o.payment_provider IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
        AND (
          o.expires_at <= now()
          OR (o.pay_expires_at IS NOT NULL AND o.pay_expires_at <= now())
        )
      LIMIT 1`,
    [orderId, userId],
  );
  const deposit = result.rows[0];
  if (!deposit) return false;
  if (
    Number(deposit.received_usdt || 0) > 0 ||
    ["confirming", "confirmed", "overpaid", "manual"].includes(deposit.status)
  ) {
    return false;
  }
  if (deposit.id && deposit.address) {
    const check = await checkShopDepositBeforeExpiry(deposit);
    if (check !== "clear") return false;
  }

  const cancelled = await query<{ id: string }>(
    `UPDATE shop_orders o
        SET status = 'expired', updated_at = now()
      WHERE o.id = $1
        AND o.user_id = $2
        AND o.status = 'pending_payment'
        AND o.payment_provider IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
        AND NOT EXISTS (
          SELECT 1
            FROM shop_usdt_deposits d
           WHERE d.order_id = o.id
             AND (
               d.received_usdt > 0
               OR d.status IN ('confirming', 'confirmed', 'overpaid', 'manual')
             )
        )
      RETURNING o.id`,
    [orderId, userId],
  );
  if (!cancelled.rows[0]) return false;
  await query(
    `UPDATE shop_usdt_deposits
        SET status = 'expired', updated_at = now()
      WHERE order_id = $1 AND status IN ('waiting', 'expired')`,
    [orderId],
  );
  await query(
    `INSERT INTO shop_order_events (order_id, actor_type, event, note)
     VALUES ($1, 'system', 'expired', '超时未支付，自动取消')`,
    [orderId],
  );
  return true;
}

export async function scanShopUsdtDeposits(limit = 20): Promise<{
  checked: number;
  paid: number;
  partial: number;
  errors: number;
}> {
  // Disabling a channel must not abandon deposits already quoted to customers.
  const result = await query<ShopUsdtDeposit & { order_amount_micros: string | number }>(
    `SELECT d.id, d.order_id, d.network, d.address, d.derivation_index,
            d.expected_usdt, d.received_usdt, d.txid, d.block_number,
            d.confirmations, d.status, d.expires_at, d.last_checked_at,
            d.scan_from_block,
            o.amount_micros AS order_amount_micros
       FROM shop_usdt_deposits d
       JOIN shop_orders o ON o.id = d.order_id
      WHERE d.status IN ('waiting', 'partial', 'confirming', 'expired')
        AND d.expires_at > now() - ($2::int * interval '1 hour')
        AND o.status = 'pending_payment'
      ORDER BY d.created_at
      LIMIT $1`,
    [limit, config.shopUsdtGraceHours],
  );
  if (result.rows.length === 0) return { checked: 0, paid: 0, partial: 0, errors: 0 };

  // Pace TRON requests so a keyless TronGrid does not rate-limit the scan.
  const usdtSettings = await getUsdtSettings();
  const throttleMs = usdtSettings.usdtTronGridApiKey ? 200 : 1_200;
  let paid = 0;
  let partial = 0;
  let errors = 0;

  for (const deposit of result.rows) {
    try {
      const network: UsdtNetwork = isUsdtNetwork(deposit.network) ? deposit.network : "trc20";
      // One chain failing must not stop the others; each row is isolated.
      const { received, latest, head } = await observeDeposit(deposit);
      const total = received;
      const expected = toNumber(deposit.expected_usdt);
      const confirmations = latest ? Math.max(0, head - latest.block) : 0;

      const evaluation = evaluateUsdtDeposit({
        currentStatus: deposit.status,
        expectedUsdt: expected,
        receivedUsdt: total,
        confirmations,
        requiredConfirmations: USDT_NETWORKS[network].requiredConfirmations,
        expiresAt: deposit.expires_at,
        toleranceUsdt: amountToleranceUsdt(expected),
      });

      const updated = await query<{ status: string }>(
        `UPDATE shop_usdt_deposits
            SET received_usdt = $2, txid = COALESCE($3, txid),
                block_number = COALESCE($4, block_number), confirmations = $5,
                status = $6, last_checked_at = now(), updated_at = now()
          WHERE id = $1 AND status IN ('waiting', 'partial', 'confirming', 'expired')
          RETURNING status`,
        [
          deposit.id,
          total,
          latest?.txid || null,
          latest?.block ?? null,
          confirmations,
          evaluation.status,
        ],
      );
      if (!updated.rows[0]) continue;

      if (evaluation.status === "confirmed" || evaluation.status === "overpaid") {
        try {
          await markShopOrderPaid({
            orderNo: (
              await query<{ order_no: string }>(
                "SELECT order_no FROM shop_orders WHERE id = $1 LIMIT 1",
                [deposit.order_id],
              )
            ).rows[0].order_no,
            provider: providerForNetwork(network),
            providerRef: latest?.txid || `usdt:${deposit.order_id}`,
            payTxid: latest?.txid || undefined,
            paidAmountMicros: toNumber(deposit.order_amount_micros),
            note: `USDT 已确认 ${total} USDT（${evaluation.status}）`,
          });
          void notifyShopOrderPaid(deposit.order_id);
          paid += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (message === "ORDER_CLOSED") {
            await query(
              `UPDATE shop_usdt_deposits
                  SET status = 'manual', last_checked_at = now(), updated_at = now()
                WHERE id = $1`,
              [deposit.id],
            );
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
        "[shop-usdt] scan failed",
        deposit.order_id,
        error instanceof Error ? error.message : error,
      );
      await query(
        "UPDATE shop_usdt_deposits SET last_checked_at = now(), updated_at = now() WHERE id = $1",
        [deposit.id],
      );
    } finally {
      // Stay under TronGrid's quota on small keys and the public endpoint.
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }

  return { checked: result.rows.length, paid, partial, errors };
}
