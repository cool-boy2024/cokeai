import { query } from "../src/lib/db";
import { fulfillOrder } from "../src/lib/orders";

async function main() {
  const u = await query<{ id: string; email: string }>(
    "select id, email from users order by created_at limit 1",
  );
  const p = await query<{
    id: string;
    name: string;
    price_micros: string;
    credits_micros: string;
    duration_days: number;
  }>(
    "select id, name, price_micros, credits_micros, duration_days from plans where active order by sort_order limit 1",
  );
  const plan = p.rows[0];
  const o = await query<{ id: string }>(
    `insert into orders (user_id, plan_id, amount_micros, credits_micros, duration_days, payment_provider)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [u.rows[0].id, plan.id, plan.price_micros, plan.credits_micros, plan.duration_days, "manual"],
  );
  const orderId = o.rows[0].id;
  const result = await fulfillOrder(orderId);
  console.log("fulfill", result);
  const op = await query(
    "select status, amount_credit, reference, last_error from gateway_balance_ops where order_id = $1",
    [orderId],
  );
  console.log("op", op.rows[0]);
  const local = await query(
    "select balance_micros, gateway_balance_synced_at from users where id = $1",
    [u.rows[0].id],
  );
  console.log("local", local.rows[0]);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
