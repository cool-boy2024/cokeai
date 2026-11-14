import type { PoolClient } from "pg";
import { receiptReference } from "./validation";

/**
 * Register a verified personal-Alipay transfer.
 *
 * (provider, receipt_ref) is globally unique: one real transfer can settle one
 * order only. The insert uses ON CONFLICT DO NOTHING so a duplicate is a
 * normal, explainable outcome instead of PostgreSQL error 23505 leaking into
 * the admin UI. Re-claiming the same order is idempotent.
 */
export async function claimPersonalAlipayReceipt(
  client: PoolClient,
  input: {
    orderId: string;
    orderKind: "credits" | "shop";
    reference: string;
    amountMicros: number | string;
    adminId: string;
  },
): Promise<void> {
  const ref = receiptReference(input.reference);
  const inserted = await client.query(
    `INSERT INTO payment_receipts
       (order_id, order_kind, provider, receipt_ref, amount_micros, reviewed_by)
     VALUES ($1, $2, 'personal_alipay', $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING order_id`,
    [input.orderId, input.orderKind, ref, input.amountMicros, input.adminId],
  );
  if (inserted.rows[0]) return;

  const owner = await client.query<{
    order_id: string;
    order_kind: string;
    order_no: string | null;
  }>(
    `SELECT r.order_id, r.order_kind, s.order_no
       FROM payment_receipts r
       LEFT JOIN shop_orders s
         ON r.order_kind = 'shop' AND s.id = r.order_id
      WHERE r.provider = 'personal_alipay' AND r.receipt_ref = $1`,
    [ref],
  );
  const row = owner.rows[0];

  if (row && row.order_id === input.orderId && row.order_kind === input.orderKind) {
    return;
  }
  if (row) {
    const label =
      row.order_kind === "shop"
        ? `小店订单 ${row.order_no || row.order_id.slice(0, 8)}`
        : `充值订单 ${row.order_id.slice(0, 8)}`;
    throw new Error(
      `DUPLICATE_RECEIPT：交易号 ${ref} 已登记在${label}，同一笔转账不能重复使用。请核对支付宝账单后改用另一笔交易号`,
    );
  }

  // The conflicting key was order_id (this order already has another receipt),
  // which should not happen for a pending order.
  const sameOrder = await client.query<{ receipt_ref: string }>(
    "SELECT receipt_ref FROM payment_receipts WHERE order_id = $1",
    [input.orderId],
  );
  if (sameOrder.rows[0]) {
    throw new Error(
      `DUPLICATE_RECEIPT：本订单已登记交易号 ${sameOrder.rows[0].receipt_ref}，请刷新页面后核对`,
    );
  }
  throw new Error("DUPLICATE_RECEIPT：该交易号已被使用，请核对支付宝账单");
}
