import { loadEnv } from "./env.mjs";

loadEnv();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { config } = await import("../src/lib/config");
  const { hashPassword } = await import("../src/lib/auth");
  const {
    createShopOrder,
    decryptCustomerInput,
    deliverShopItem,
    expireShopOrders,
    findShopOrderByNo,
    markShopItemOutOfStock,
    markShopOrderPaid,
    purgeDeliveredCustomerInputs,
    refundShopOrder,
    revealShopDelivery,
    startShopProcurement,
  } = await import("../src/lib/shop/orders");

  const email = `shop-test-${Date.now()}@example.com`;
  const passwordHash = await hashPassword("ShopTest123!");
  const user = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'Shop Test', $3) RETURNING id`,
    [email, passwordHash, `SHOP${Date.now().toString(36).toUpperCase()}`],
  );
  const userId = user.rows[0].id;
  await query("UPDATE users SET role = 'admin' WHERE id = $1", [userId]);

  const other = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'Shop Other', $3) RETURNING id`,
    [`shop-other-${Date.now()}@example.com`, passwordHash, `OTH${Date.now().toString(36).toUpperCase()}`],
  );
  const otherUserId = other.rows[0].id;

  const product = await query<{
    id: string;
    slug: string;
    price_micros: string;
    availability: string;
  }>(
    `SELECT id, slug, price_micros, availability FROM shop_products
      WHERE status = 'active' AND copy_ready = TRUE
      ORDER BY sort_order LIMIT 1`,
  );
  assert(product.rows[0], "no seeded product");
  const item = product.rows[0];
  const price = Number(item.price_micros);

  // Price tampering must be rejected.
  let priceRejected = false;
  try {
    await createShopOrder({
      userId,
      productId: item.id,
      expectedPriceMicros: price - 1,
      paymentProvider: "manual",
    });
  } catch (error) {
    priceRejected = error instanceof Error && error.message === "PRICE_CHANGED";
  }
  assert(priceRejected, "tampered price was accepted");

  if (config.shopMaxQty >= 2) {
    const qtyOrder = await createShopOrder({
      userId,
      productId: item.id,
      expectedPriceMicros: price,
      qty: 2,
      contactEmail: "buyer@example.com",
      customerInput: { chatgpt_email: "user@example.com" },
      paymentProvider: "manual",
    });
    assert(qtyOrder.amountMicros === price * 2, "quantity amount mismatch");
    const qtyDetail = await findShopOrderByNo(qtyOrder.orderNo, userId);
    assert(qtyDetail?.qty === 2, "quantity not stored");
    assert(
      qtyDetail?.amount_micros === price * 2,
      "quantity order total not stored",
    );
    assert(
      decryptCustomerInput(qtyDetail?.customer_input_encrypted ?? null)
        .contactEmail === "buyer@example.com",
      "contact email not stored",
    );
    await query("UPDATE shop_orders SET status = 'cancelled' WHERE id = $1", [
      qtyOrder.id,
    ]);

    let overQtyRejected = false;
    try {
      await createShopOrder({
        userId,
        productId: item.id,
        expectedPriceMicros: price,
        qty: config.shopMaxQty + 1,
        paymentProvider: "manual",
      });
    } catch (error) {
      overQtyRejected =
        error instanceof Error && error.message.includes("购买数量");
    }
    assert(overQtyRejected, "over-limit quantity was accepted");
  }

  const order = await createShopOrder({
    userId,
    productId: item.id,
    expectedPriceMicros: price,
    paymentProvider: "manual",
    customerInput: { chatgpt_email: "user@example.com" },
    note: "e2e order",
  });

  const pending = await findShopOrderByNo(order.orderNo, userId);
  assert(pending?.status === "pending_payment", "order not pending");
  assert(pending.amount_micros === price, "order amount mismatch");

  const paid = await markShopOrderPaid({
    orderNo: order.orderNo,
    provider: "manual",
    providerRef: `manual-test-${order.orderNo}`,
    paidAmountMicros: price,
    adminId: userId,
  });
  assert(!paid.alreadyPaid, "order already paid");
  const paidAgain = await markShopOrderPaid({
    orderNo: order.orderNo,
    provider: "manual",
    providerRef: `manual-test-${order.orderNo}`,
    paidAmountMicros: price,
    adminId: userId,
  });
  assert(paidAgain.alreadyPaid, "payment is not idempotent");

  await startShopProcurement({
    orderId: order.id,
    adminId: userId,
    supplierOrderRef: "SUP-E2E-1",
    note: "e2e procurement",
  });

  await deliverShopItem({
    orderId: order.id,
    adminId: userId,
    kind: "code",
    payload: { 卡密: "E2E-CODE-123456", 兑换说明: "测试说明" },
    note: "e2e delivery",
  });

  const delivered = await findShopOrderByNo(order.orderNo, userId);
  assert(delivered?.status === "delivered", "order not delivered");
  assert(delivered.procurement_status === "delivered", "item not delivered");

  const stored = await query<{ delivery_payload_encrypted: string }>(
    "SELECT delivery_payload_encrypted FROM shop_order_items WHERE order_id = $1",
    [order.id],
  );
  assert(
    stored.rows[0]?.delivery_payload_encrypted &&
      !stored.rows[0].delivery_payload_encrypted.includes("E2E-CODE-123456"),
    "delivery payload is not encrypted",
  );

  const revealed = await revealShopDelivery({ orderId: order.id, userId });
  assert(revealed.payload["卡密"] === "E2E-CODE-123456", "revealed payload mismatch");

  let foreignRejected = false;
  try {
    await revealShopDelivery({ orderId: order.id, userId: otherUserId });
  } catch (error) {
    foreignRejected = error instanceof Error && error.message === "订单不存在";
  }
  assert(foreignRejected, "another user could read delivery");

  // Out-of-stock -> refund flow.
  const order2 = await createShopOrder({
    userId,
    productId: item.id,
    expectedPriceMicros: price,
    paymentProvider: "manual",
    customerInput: { chatgpt_email: "user@example.com" },
  });
  await markShopOrderPaid({
    orderNo: order2.orderNo,
    provider: "manual",
    providerRef: `manual-test-${order2.orderNo}`,
    paidAmountMicros: price,
    adminId: userId,
  });
  await markShopItemOutOfStock({ orderId: order2.id, adminId: userId, reason: "e2e oos" });
  const refundPending = await findShopOrderByNo(order2.orderNo, userId);
  assert(refundPending?.status === "refund_pending", "out-of-stock did not enter refund");
  await refundShopOrder({
    orderId: order2.id,
    adminId: userId,
    amountMicros: price,
    reason: "e2e refund",
  });
  const refunded = await findShopOrderByNo(order2.orderNo, userId);
  assert(refunded?.status === "refunded", "refund did not complete");

  // Expiry and customer-input retention.
  const order3 = await createShopOrder({
    userId,
    productId: item.id,
    expectedPriceMicros: price,
    paymentProvider: "manual",
    customerInput: { chatgpt_email: "user@example.com" },
  });
  await query("UPDATE shop_orders SET expires_at = now() - interval '1 minute' WHERE id = $1", [
    order3.id,
  ]);
  const expired = await expireShopOrders();
  assert(expired >= 1, "expireShopOrders did not close the order");
  const closed = await findShopOrderByNo(order3.orderNo, userId);
  assert(closed?.status === "expired", "order not expired");

  const order4 = await createShopOrder({
    userId,
    productId: item.id,
    expectedPriceMicros: price,
    paymentProvider: "manual",
    customerInput: { chatgpt_email: "user@example.com" },
  });
  await query(
    `UPDATE shop_order_items
        SET customer_input_encrypted = 'x', delivered_at = now() - interval '8 days'
      WHERE order_id = $1`,
    [order4.id],
  );
  const purged = await purgeDeliveredCustomerInputs();
  assert(purged >= 1, "customer input purge did not run");
  const purgedRow = await query<{ customer_input_encrypted: string | null }>(
    "SELECT customer_input_encrypted FROM shop_order_items WHERE order_id = $1",
    [order4.id],
  );
  assert(purgedRow.rows[0]?.customer_input_encrypted === null, "customer input not purged");

  console.log(
    JSON.stringify(
      {
        ok: true,
        userId,
        order: order.orderNo,
        refunded: order2.orderNo,
        expired: order3.orderNo,
        revealed: Object.keys(revealed.payload),
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
