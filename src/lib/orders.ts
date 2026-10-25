import { config } from "./config";
import { withTransaction } from "./db";

export async function fulfillOrder(orderId: string): Promise<{
  fulfilled: boolean;
  alreadyPaid: boolean;
  userId: string;
  planName: string;
}> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      user_id: string;
      plan_id: string;
      plan_name: string;
      amount_micros: string;
      credits_micros: string;
      duration_days: number;
      status: string;
      referred_by: string | null;
    }>(
      `SELECT o.id, o.user_id, o.plan_id, p.name AS plan_name, o.amount_micros,
              o.credits_micros, o.duration_days, o.status, u.referred_by
         FROM orders o
         JOIN plans p ON p.id = o.plan_id
         JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
        FOR UPDATE OF o`,
      [orderId],
    );

    const order = result.rows[0];
    if (!order) throw new Error("订单不存在");
    if (order.status === "paid") {
      return {
        fulfilled: false,
        alreadyPaid: true,
        userId: order.user_id,
        planName: order.plan_name,
      };
    }
    if (order.status !== "pending") {
      throw new Error("订单状态不可完成");
    }

    await client.query(
      `UPDATE orders
          SET status = 'paid', paid_at = now(), updated_at = now()
        WHERE id = $1`,
      [orderId],
    );

    const userResult = await client.query<{
      plan_id: string | null;
      plan_expires_at: string | null;
    }>(
      `SELECT plan_id, plan_expires_at
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [order.user_id],
    );
    const user = userResult.rows[0];
    const samePlan = user.plan_id === order.plan_id;

    await client.query(
      `UPDATE users
          SET balance_micros = balance_micros + $2,
              plan_id = $1,
              plan_expires_at =
                (CASE WHEN $6::boolean THEN GREATEST(now(), $3::timestamptz) ELSE now() END)
                + make_interval(days => $4),
              updated_at = now()
        WHERE id = $5`,
      [
        order.plan_id,
        order.credits_micros,
        user.plan_expires_at,
        order.duration_days,
        order.user_id,
        samePlan,
      ],
    );

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
    };
  });
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
