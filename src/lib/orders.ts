import { config } from "./config";
import { withTransaction } from "./db";
import { applyCreditOpById, enqueueTopup } from "./gateway-credits";
import { claimPersonalAlipayReceipt } from "./payments/receipts";

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
      plan_kind: string;
      duration_days: number;
      amount_micros: string;
      credits_micros: string;
      status: string;
      payment_provider: string;
      referred_by: string | null;
    }>(
      `SELECT o.id, o.user_id, o.plan_id, p.name AS plan_name, p.kind AS plan_kind,
              o.duration_days, o.amount_micros,
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

    const isMembership = order.plan_kind === "membership";

    if (order.status === "paid") {
      // Membership activation is local and finished in the same transaction,
      // so a paid membership order has nothing left pending in the outbox.
      if (isMembership) {
        return {
          fulfilled: false,
          alreadyPaid: true,
          userId: order.user_id,
          planName: order.plan_name,
          opId: null,
          creditStatus: "applied" as const,
        };
      }
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
      await claimPersonalAlipayReceipt(client, {
        orderId,
        orderKind: "credits",
        reference: manualReceipt.reference,
        amountMicros: manualReceipt.amountMicros,
        adminId: manualReceipt.adminId,
      });
    }

    await client.query(
      `UPDATE orders
          SET status = 'paid', paid_at = now(), updated_at = now()
        WHERE id = $1`,
      [orderId],
    );

    // Membership is local state: the paid order activates the member price for
    // one term. Buying again while active extends from the current expiry, so
    // a renewal never loses the remaining days.
    if (isMembership) {
      const days = Math.max(1, Math.trunc(Number(order.duration_days) || 365));
      await client.query(
        `UPDATE users
            SET plan_id = $2,
                plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now())
                                  + make_interval(days => $3),
                updated_at = now()
          WHERE id = $1`,
        [order.user_id, order.plan_id, days],
      );
    }

    // Credits are authoritative in Sub2API. Write one durable outbox row in the
    // same transaction, then apply it outside the transaction. Membership has
    // no balance side effect.
    const op = isMembership
      ? null
      : await enqueueTopup(client, {
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
      opId: op?.id || null,
      creditStatus: isMembership ? ("applied" as const) : ("pending" as const),
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
