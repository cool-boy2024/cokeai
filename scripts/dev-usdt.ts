import { query } from "../src/lib/db";
import { createUsdtDeposit } from "../src/lib/payments/usdt";

async function main() {
  const user = await query<{ id: string }>(
    "select id from users where email = 'admin@cokeai.local'",
  );
  const plan = await query<{
    id: string;
    price_micros: string;
    credits_micros: string;
    duration_days: number;
  }>(
    "select id, price_micros, credits_micros, duration_days from plans where active order by sort_order limit 1",
  );
  const order = await query<{ id: string }>(
    `insert into orders
      (user_id, plan_id, amount_micros, credits_micros, duration_days, payment_provider)
     values ($1, $2, $3, $4, $5, 'usdt_trc20')
     returning id`,
    [
      user.rows[0].id,
      plan.rows[0].id,
      plan.rows[0].price_micros,
      plan.rows[0].credits_micros,
      plan.rows[0].duration_days,
    ],
  );
  const deposit = await createUsdtDeposit({
    orderId: order.rows[0].id,
    amountYuan: Number(plan.rows[0].price_micros) / 1_000_000,
  });
  console.log(
    JSON.stringify(
      { orderId: order.rows[0].id, ...deposit },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
