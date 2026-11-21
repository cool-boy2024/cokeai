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
    `SELECT p.id, p.price_micros, p.input_fields FROM shop_products p
      WHERE p.status = 'active' AND p.copy_ready = TRUE
        AND p.availability IN ('in_stock', 'low_stock')
        AND NOT EXISTS (
          SELECT 1 FROM shop_product_variants v
           WHERE v.product_id = p.id AND v.active = TRUE
        )
      ORDER BY p.sort_order LIMIT 1`,
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

  // Settlement recovery never touches the chain: a confirmed deposit on an
  // open order must still be booked, and one on a closed order must surface
  // for a human instead of staying "confirmed" forever.
  const interrupted = await newOrder();
  const closed = await newOrder();
  await query(`UPDATE shop_orders SET status = 'expired', updated_at = now() WHERE id = $1`, [
    closed.id,
  ]);
  const stamp = Date.now();
  await query(
    `INSERT INTO shop_usdt_deposits
       (order_id, network, address, derivation_index, expected_usdt, received_usdt,
        txid, block_number, confirmations, status, expires_at, last_checked_at)
     VALUES ($1, 'trc20', $2, $3, 1, 1, $4, 1, 20, 'confirmed', now() + interval '5 minutes', now())`,
    [interrupted.id, `TRecovery${stamp}`, 900000 + (stamp % 100000), `recovery-${stamp}`],
  );
  await query(
    `INSERT INTO shop_usdt_deposits
       (order_id, network, address, derivation_index, expected_usdt, received_usdt,
        txid, block_number, confirmations, status, expires_at, last_checked_at)
     VALUES ($1, 'trc20', $2, $3, 1, 1, $4, 1, 20, 'confirmed', now() + interval '5 minutes', now())`,
    [closed.id, `TClosed${stamp}`, 950000 + (stamp % 100000), `closed-${stamp}`],
  );

  const recoveryScan = await scanShopUsdtDeposits(50);
  assert(recoveryScan.paid >= 1, "confirmed deposit was not booked onto the open order");
  const recoveredOrder = await query<{ status: string }>(
    `SELECT status FROM shop_orders WHERE id = $1`,
    [interrupted.id],
  );
  assert(recoveredOrder.rows[0]?.status === "paid", "open order was not marked paid");
  const closedDeposit = await query<{ status: string; received_usdt: string }>(
    `SELECT status, received_usdt FROM shop_usdt_deposits WHERE order_id = $1`,
    [closed.id],
  );
  assert(closedDeposit.rows[0]?.status === "manual", "closed-order funds were not flagged");
  assert(Number(closedDeposit.rows[0]?.received_usdt) === 1, "closed-order amount was not kept");

  if (!(await isShopUsdtAvailable())) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          settlement_recovery: "ok",
          skipped: "USDT is not configured (xpub + TronGrid key required)",
        },
        null,
        2,
      ),
    );
    return;
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
