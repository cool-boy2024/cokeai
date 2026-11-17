import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, getPool } from "../src/lib/db";
import { addManualShopSource, validateManualShopSource } from "../src/lib/shop/manual-source";
import { startShopProcurement } from "../src/lib/shop/orders";

// This integration test writes fixtures. Require a dedicated local connection
// instead of inheriting a developer's usual DATABASE_URL or loading .env.
const testDatabaseUrl = process.env.MANUAL_SOURCE_TEST_DATABASE_URL;
if (!testDatabaseUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(testDatabaseUrl).hostname)) {
  throw new Error("Set MANUAL_SOURCE_TEST_DATABASE_URL to a disposable local PostgreSQL database");
}
process.env.DATABASE_URL = testDatabaseUrl;
const fixtureTag = `manual-source-${randomUUID()}`;
let fixtureUserId: string | undefined;
let fixtureProductId: string | undefined;

async function createOrder(adminId: string, productId: string, variantId: string, no: string, status = "pending_payment") {
  const order = await query<{ id: string }>(
    `INSERT INTO shop_orders (order_no, user_id, status, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
    [`${fixtureTag}-${no}`, adminId, status],
  );
  await query(
    `INSERT INTO shop_order_items
       (order_id, product_id, product_slug, product_name, brand, variant_id,
        unit_price_micros, qty, procurement_status)
     VALUES ($1, $2, 'manual-source-smoke', 'Test', 'muse', $3, 50000000, 2, $4)`,
    [order.rows[0].id, productId, variantId, status === "paid" ? "to_buy" : "pending"],
  );
  return order.rows[0].id;
}

async function main() {
  const user = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, referral_code)
     VALUES ($1, 'test', 'Test', 'admin', $2) RETURNING id`,
    [`${fixtureTag}@example.invalid`, fixtureTag],
  );
  const adminId = user.rows[0].id;
  fixtureUserId = adminId;
  const product = await query<{ id: string }>(
    `INSERT INTO shop_products
       (slug, name, brand, category, product_type, price_micros, status, availability)
     VALUES ($1, 'Test', 'muse', 'account', 'account', 50000000, 'active', 'in_stock') RETURNING id`,
    [fixtureTag],
  );
  const productId = product.rows[0].id;
  fixtureProductId = productId;
  const variant = await query<{ id: string }>(
    `INSERT INTO shop_product_variants (product_id, variant_key, label, price_micros)
     VALUES ($1, 'test', 'Test', 50000000) RETURNING id`,
    [productId],
  );
  const variantId = variant.rows[0].id;

  const orderOnly = await createOrder(adminId, productId, variantId, 'TEST-ORDER-ONLY');
  const input = {
    orderId: orderOnly, adminId, sourceStore: 'Offline supplier',
    sourceTitle: 'Muse test account', sourceUrl: '', costYuan: '13.00',
    availability: 'in_stock', scope: 'order',
  };
  assert.equal(validateManualShopSource(input).costMicros, 13_000_000n);
  await addManualShopSource(input);
  const snapshot = await query<{
    status: string; supplier_offer_id: string; supplier_cost_micros: string;
    kind: string; scope: string; mapping_count: string;
  }>(
    `SELECT o.status, i.supplier_offer_id, i.supplier_cost_micros,
            s.kind, f.raw->>'scope' AS scope,
            (SELECT COUNT(*)::text FROM shop_product_sources WHERE offer_id = f.id) AS mapping_count
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
       JOIN shop_offers f ON f.id = i.supplier_offer_id
       JOIN shop_suppliers s ON s.id = f.supplier_id
      WHERE o.id = $1`,
    [orderOnly],
  );
  assert.equal(snapshot.rows[0].status, 'pending_payment');
  assert.equal(Number(snapshot.rows[0].supplier_cost_micros), 26_000_000);
  assert.equal(snapshot.rows[0].kind, 'manual');
  assert.equal(snapshot.rows[0].scope, 'order');
  assert.equal(snapshot.rows[0].mapping_count, '0');
  await assert.rejects(() => addManualShopSource(input), /已有货源/);

  // Unbinding an automatic/product source must still let an unpurchased
  // order replace its stale checkout snapshot with a real manual source.
  const staleOrder = await createOrder(adminId, productId, variantId, 'TEST-STALE-SOURCE');
  await query(
    `UPDATE shop_order_items SET supplier_offer_id = $2 WHERE order_id = $1`,
    [staleOrder, snapshot.rows[0].supplier_offer_id],
  );
  await addManualShopSource({ ...input, orderId: staleOrder });
  const replaced = await query<{ supplier_offer_id: string }>(
    `SELECT supplier_offer_id FROM shop_order_items WHERE order_id = $1`,
    [staleOrder],
  );
  assert.notEqual(replaced.rows[0].supplier_offer_id, snapshot.rows[0].supplier_offer_id);

  const expensiveOrder = await createOrder(adminId, productId, variantId, 'TEST-EXPENSIVE');
  await assert.rejects(
    () => addManualShopSource({ ...input, orderId: expensiveOrder, costYuan: '49.00', scope: 'product' }),
    /售价不足/,
  );
  const expensiveItem = await query<{ supplier_offer_id: string | null }>(
    `SELECT supplier_offer_id FROM shop_order_items WHERE order_id = $1`,
    [expensiveOrder],
  );
  assert.equal(expensiveItem.rows[0].supplier_offer_id, null);

  const productOrder = await createOrder(adminId, productId, variantId, 'TEST-PRODUCT', 'paid');
  await addManualShopSource({ ...input, orderId: productOrder, costYuan: '20.00', scope: 'product' });
  const mapped = await query<{ variant_id: string; supplier_offer_id: string; procurement_status: string }>(
    `SELECT s.variant_id, i.supplier_offer_id, i.procurement_status
       FROM shop_order_items i
       JOIN shop_product_sources s ON s.offer_id = i.supplier_offer_id
      WHERE i.order_id = $1`,
    [productOrder],
  );
  assert.equal(mapped.rows[0].variant_id, variantId);
  assert.equal(mapped.rows[0].procurement_status, 'to_buy');
  await startShopProcurement({ orderId: productOrder, adminId });
  const bought = await query<{ procurement_status: string; supplier_offer_id: string }>(
    `SELECT procurement_status, supplier_offer_id FROM shop_order_items WHERE order_id = $1`,
    [productOrder],
  );
  assert.equal(bought.rows[0].procurement_status, 'bought');
  assert.equal(bought.rows[0].supplier_offer_id, mapped.rows[0].supplier_offer_id);

  assert.throws(
    () => validateManualShopSource({ ...input, sourceUrl: 'javascript:alert(1)' }),
    /http\(s\)/,
  );
  assert.throws(
    () => validateManualShopSource({ ...input, availability: 'out_of_stock', scope: 'product' }),
    /只能添加有货/,
  );
  const closedOrder = await createOrder(adminId, productId, variantId, 'TEST-CLOSED', 'expired');
  await assert.rejects(() => addManualShopSource({ ...input, orderId: closedOrder }), /当前订单不能/);
  console.log('manual source integration: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (fixtureUserId) {
      await query(
        `DELETE FROM shop_offers WHERE raw->>'entered_for_order' IN
          (SELECT id::text FROM shop_orders WHERE user_id = $1)`,
        [fixtureUserId],
      );
      await query("DELETE FROM shop_orders WHERE user_id = $1", [fixtureUserId]);
    }
    if (fixtureProductId) await query("DELETE FROM shop_products WHERE id = $1", [fixtureProductId]);
    if (fixtureUserId) await query("DELETE FROM users WHERE id = $1", [fixtureUserId]);
  } finally {
    await getPool().end();
  }
});
