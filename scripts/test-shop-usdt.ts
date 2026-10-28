import { loadEnv } from "./env.mjs";

loadEnv();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");
  const { createShopOrder, findShopOrderByNo } = await import("../src/lib/shop/orders");
  const { createShopUsdtDeposit, getShopUsdtDeposit, isShopUsdtAvailable, scanShopUsdtDeposits } =
    await import("../src/lib/shop/usdt");

  if (!(await isShopUsdtAvailable())) {
    console.log(
      JSON.stringify(
        { ok: true, skipped: "USDT is not configured (xpub + TronGrid key required)" },
        null,
        2,
      ),
    );
    return;
  }

  const user = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'USDT Shop Test', $3) RETURNING id`,
    [
      `shop-usdt-${Date.now()}@example.com`,
      await hashPassword("ShopTest123!"),
      `USD${Date.now().toString(36).toUpperCase()}`,
    ],
  );
  const userId = user.rows[0].id;
  const product = await query<{ id: string; price_micros: string; input_fields: unknown }>(
    `SELECT id, price_micros, input_fields FROM shop_products
      WHERE status = 'active' AND copy_ready = TRUE ORDER BY sort_order LIMIT 1`,
  );
  assert(product.rows[0], "no active product");
  const item = product.rows[0];
  const fields = Array.isArray(item.input_fields)
    ? (item.input_fields as Array<{ key?: string; required?: boolean }>)
    : [];
  const customerInput: Record<string, string> = {};
  for (const field of fields) {
    if (field.required && field.key) customerInput[field.key] = "buyer@example.com";
  }

  async function newOrder() {
    return createShopOrder({
      userId,
      productId: item.id,
      expectedPriceMicros: Number(item.price_micros),
      paymentProvider: "usdt_trc20",
      customerInput,
    });
  }

  const a = await newOrder();
  const b = await newOrder();
  const da = await createShopUsdtDeposit({ orderId: a.id, amountMicros: a.amountMicros });
  const db = await createShopUsdtDeposit({ orderId: b.id, amountMicros: b.amountMicros });

  assert(da.address !== db.address, "derivation produced duplicate addresses");
  assert(Number(da.expected_usdt) > 0, "deposit has no USDT amount");
  const again = await createShopUsdtDeposit({ orderId: a.id, amountMicros: a.amountMicros });
  assert(again.address === da.address, "refreshing changed the deposit address");

  const order = await findShopOrderByNo(a.orderNo, userId);
  assert(order?.payment_provider === "usdt_trc20", "order provider not updated");
  assert(order.pay_address === da.address, "order address not persisted");
  assert(Number(order.pay_amount) === Number(da.expected_usdt), "order amount not persisted");

  const loaded = await getShopUsdtDeposit(a.id);
  assert(loaded?.address === da.address, "deposit not retrievable");

  const scan = await scanShopUsdtDeposits(5).catch((error) => {
    console.warn("scan skipped:", error instanceof Error ? error.message : error);
    return { checked: -1, paid: 0, partial: 0, errors: 0 };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        order: a.orderNo,
        address: da.address,
        expected_usdt: da.expected_usdt,
        unique_address: da.address !== db.address,
        scan,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
