import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import {
  amountToleranceUsdt,
  currentTronBlock,
  deriveTronAddress,
  evaluateUsdtDeposit,
  isUsdtConfigured,
  listTransfers,
  quoteUsdt,
  transferAmountUsdt,
  type UsdtDepositStatus,
} from "@/lib/payments/usdt";
import { getUsdtSettings } from "@/lib/payments/settings";
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
};

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export async function isShopUsdtAvailable(): Promise<boolean> {
  return isUsdtConfigured();
}

export async function createShopUsdtDeposit(input: {
  orderId: string;
  amountMicros: number;
}): Promise<ShopUsdtDeposit> {
  if (!(await isUsdtConfigured())) throw new Error("USDT 支付尚未配置");

  const amountYuan = input.amountMicros / 1_000_000;
  const settings = await getUsdtSettings();
  const quote = await quoteUsdt(amountYuan);
  if (quote.amountUsdt < config.usdtMinAmount) {
    throw new Error(`USDT 单笔最低 ${config.usdtMinAmount} USDT`);
  }

  const quoteExpires = new Date(Date.now() + config.usdtQuoteMinutes * 60_000);
  const orderExpires = new Date(
    quoteExpires.getTime() + config.shopUsdtGraceHours * 60 * 60_000,
  );

  return withTransaction(async (client) => {
    const existing = await client.query<ShopUsdtDeposit>(
      `SELECT id, order_id, network, address, derivation_index, expected_usdt,
              received_usdt, txid, block_number, confirmations, status,
              expires_at, last_checked_at
         FROM shop_usdt_deposits
        WHERE order_id = $1
        FOR UPDATE`,
      [input.orderId],
    );
    if (existing.rows[0]) return existing.rows[0];

    const order = await client.query<{ status: string; amount_micros: string | number }>(
      `SELECT status, amount_micros FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const row = order.rows[0];
    if (!row) throw new Error("订单不存在");
    if (row.status !== "pending_payment") throw new Error("订单状态不可支付");
    if (toNumber(row.amount_micros) !== input.amountMicros) throw new Error("订单金额变化，请刷新");

    const seq = await client.query<{ index: string }>(
      "SELECT nextval('usdt_derivation_seq')::text AS index",
    );
    const index = Number(seq.rows[0].index);
    const address = deriveTronAddress(index, settings.usdtXpub);

    await client.query(
      `UPDATE shop_orders
          SET payment_provider = 'usdt_trc20',
              pay_amount = $2,
              pay_currency = 'USDT',
              pay_address = $3,
              pay_quoted_at = now(),
              pay_expires_at = $4,
              derivation_index = $5,
              expires_at = $6,
              updated_at = now()
        WHERE id = $1 AND status = 'pending_payment'`,
      [input.orderId, quote.amountUsdt, address, quoteExpires, index, orderExpires],
    );

    const inserted = await client.query<ShopUsdtDeposit>(
      `INSERT INTO shop_usdt_deposits
         (order_id, address, derivation_index, expected_usdt, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, order_id, network, address, derivation_index, expected_usdt,
                 received_usdt, txid, block_number, confirmations, status,
                 expires_at, last_checked_at`,
      [input.orderId, address, index, quote.amountUsdt, quoteExpires],
    );
    return inserted.rows[0];
  });
}

export async function getShopUsdtDeposit(orderId: string): Promise<ShopUsdtDeposit | null> {
  const result = await query<ShopUsdtDeposit>(
    `SELECT id, order_id, network, address, derivation_index, expected_usdt,
            received_usdt, txid, block_number, confirmations, status,
            expires_at, last_checked_at
       FROM shop_usdt_deposits
      WHERE order_id = $1
      LIMIT 1`,
    [orderId],
  );
  return result.rows[0] || null;
}

export async function scanShopUsdtDeposits(limit = 20): Promise<{
  checked: number;
  paid: number;
  partial: number;
  errors: number;
}> {
  if (!(await isUsdtConfigured())) return { checked: 0, paid: 0, partial: 0, errors: 0 };

  const result = await query<ShopUsdtDeposit & { order_amount_micros: string | number }>(
    `SELECT d.id, d.order_id, d.network, d.address, d.derivation_index,
            d.expected_usdt, d.received_usdt, d.txid, d.block_number,
            d.confirmations, d.status, d.expires_at, d.last_checked_at,
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

  let block = 0;
  try {
    block = await currentTronBlock();
  } catch (error) {
    console.error("[shop-usdt] block query failed", error instanceof Error ? error.message : error);
    return { checked: result.rows.length, paid: 0, partial: 0, errors: 1 };
  }

  const contract = config.usdtContract.trim();
  const usdtSettings = await getUsdtSettings();
  // Keyless TronGrid is fine for a first small test, but pace requests far
  // slower so the public endpoint does not rate-limit the whole scan.
  const throttleMs = usdtSettings.usdtTronGridApiKey ? 200 : 1_200;
  let paid = 0;
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
      const total = round6(transfers.reduce((sum, tx) => sum + transferAmountUsdt(tx), 0));
      const expected = toNumber(deposit.expected_usdt);
      const latest = [...transfers].sort((a, b) => Number(b.block) - Number(a.block))[0];
      const confirmations = latest ? Math.max(0, block - Number(latest.block)) : 0;

      const evaluation = evaluateUsdtDeposit({
        currentStatus: deposit.status,
        expectedUsdt: expected,
        receivedUsdt: total,
        confirmations,
        requiredConfirmations: config.usdtConfirmations,
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
          latest?.transaction_id || null,
          latest ? Number(latest.block) : null,
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
            provider: "usdt_trc20",
            providerRef: latest?.transaction_id || `usdt:${deposit.order_id}`,
            payTxid: latest?.transaction_id || undefined,
            paidAmountMicros: toNumber(deposit.order_amount_micros),
            note: `USDT 已确认 ${total} USDT（${evaluation.status}）`,
          });
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
