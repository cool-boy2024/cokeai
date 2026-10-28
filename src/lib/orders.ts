import { config } from "./config";
import { withTransaction } from "./db";
import { applyCreditOpById, enqueueTopup } from "./gateway-credits";
import { receiptReference } from "./payments/validation";

export type ManualReceipt = { adminId: string; reference: string; amountMicros: string };

export async function fulfillOrder(orderId: string, manualReceipt?: ManualReceipt): Promise<{
  fulfilled: boolean;
  alreadyPaid: boolean;
  userId: string;
  planName: string;
  creditStatus: "applied" | "pending" | "failed";
}> {
  const result = await withTransaction(async (client) => {
    const orderResult = await client.query<{
      id: string;
      user_id: string;
      plan_id: string;
      plan_name: string;
      amount_micros: string;
      credits_micros: string;
      status: string;
      payment_provider: string;
      referred_by: string | null;
    }>(
      `SELECT o.id, o.user_id, o.plan_id, p.name AS plan_name, o.amount_micros,
              o.credits_micros, o.status, o.payment_provider, u.referred_by
         FROM orders o
         JOIN plans p ON p.id = o.plan_id
         JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
        FOR UPDATE OF o`,
      [orderId],
    );

    const order = orderResult.rows[0];
    if (!order) throw new Error("订单不存在");

    if (order.status === "paid") {
      const existing = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM gateway_balance_ops WHERE order_id = $1 LIMIT 1",
        [orderId],
      );
      const op = existing.rows[0];
      // A paid order whose outbox row is failed must keep reporting failed so
      // the payment webhook asks the provider to retry. The retry path below
      // is idempotent and will reuse the same reference.
      const creditStatus =
        op?.status === "applied"
          ? ("applied" as const)
          : op?.status === "failed"
            ? ("failed" as const)
            : ("pending" as const);
      return {
        fulfilled: false,
        alreadyPaid: true,
        userId: order.user_id,
        planName: order.plan_name,
        opId: op?.id || null,
        creditStatus,
      };
    }
    if (order.status !== "pending") {
      throw new Error("订单状态不可完成");
    }

    const manual = ["manual", "alipay_manual"].includes(order.payment_provider);
    if (manual && !manualReceipt) throw new Error("请先在收款账单核实交易号和金额，再通过核账页面确认");
    if (manualReceipt) {
      if (!manual) throw new Error("该渠道应通过支付回调或链上确认到账");
      const admin = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'admin' AND status = 'active'", [manualReceipt.adminId]);
      if (!admin.rows[0]) throw new Error("无权核实付款");
      if (BigInt(manualReceipt.amountMicros) !== BigInt(order.amount_micros)) throw new Error("实际到账金额与订单不一致");
      await client.query(
        `INSERT INTO payment_receipts (order_id, provider, receipt_ref, amount_micros, reviewed_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, "personal_alipay", receiptReference(manualReceipt.reference), manualReceipt.amountMicros, manualReceipt.adminId],
      );
    }

    await client.query(
      `UPDATE orders
          SET status = 'paid', paid_at = now(), updated_at = now()
        WHERE id = $1`,
      [orderId],
    );

    // Credits are authoritative in Sub2API. Write one durable outbox row in the
    // same transaction, then apply it outside the transaction.
    const op = await enqueueTopup(client, {
      userId: order.user_id,
      orderId,
      creditsMicros: Number(order.credits_micros),
    });

    if (order.referred_by && order.referred_by !== order.user_id) {
      const commissionMicros = Math.floor(
        (Number(order.amount_micros) * config.commissionBps) / 10_000,
      );
      if (commissionMicros > 0) {
        await client.query(
          `INSERT INTO commissions
            (referrer_id, buyer_id, order_id, amount_micros, rate_bps, status, available_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', now() + make_interval(days => $6))
           ON CONFLICT (order_id) DO NOTHING`,
          [
            order.referred_by,
            order.user_id,
            orderId,
            commissionMicros,
            config.commissionBps,
            config.commissionHoldDays,
          ],
        );
      }
    }

    return {
      fulfilled: true,
      alreadyPaid: false,
      userId: order.user_id,
      planName: order.plan_name,
      opId: op.id,
      creditStatus: "pending" as const,
    };
  });

  let creditStatus: "applied" | "pending" | "failed" =
    result.creditStatus === "applied" ? "applied" : "pending";
  if (result.opId && creditStatus !== "applied") {
    const applied = await applyCreditOpById(result.opId);
    if (applied?.status === "applied") creditStatus = "applied";
    else if (applied?.status === "failed") creditStatus = "failed";
  }

  return {
    fulfilled: result.fulfilled,
    alreadyPaid: result.alreadyPaid,
    userId: result.userId,
    planName: result.planName,
    creditStatus,
  };
}

export async function matureCommissions(): Promise<number> {
  const result = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE commissions
          SET status = 'available', updated_at = now()
        WHERE status = 'pending'
          AND available_at <= now()
          AND order_id IN (SELECT id FROM orders WHERE status = 'paid')
        RETURNING id`,
    );
    return updated.rowCount || 0;
  });
  return result;
}
