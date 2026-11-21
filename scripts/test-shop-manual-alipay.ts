import { loadEnv } from "./env.mjs";

loadEnv();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");
  const { savePaymentSettings, getManualAlipaySettings } = await import(
    "../src/lib/payments/settings"
  );
  const { createShopOrder, findShopOrderByNo, markShopOrderPaid } = await import(
    "../src/lib/shop/orders"
  );

  const stamp = Date.now();
  const admin = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, referral_code)
     VALUES ($1, $2, 'Alipay Admin', 'admin', $3) RETURNING id`,
    [
      `shop-alipay-admin-${stamp}@example.com`,
      await hashPassword("ShopTest123!"),
      `ALP${stamp.toString(36).toUpperCase()}`,
    ],
  );
  const adminId = admin.rows[0].id;

  await savePaymentSettings(
    "alipay_manual",
    true,
    {
      payee: "CokeAI Test",
      qrDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0x8AAAAASUVORK5CYII=",
    },
    adminId,
  );
  const settings = await getManualAlipaySettings();
  assert(settings.enabled && settings.payee === "CokeAI Test", "manual alipay settings not saved");

  const buyer = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'Alipay Buyer', $3) RETURNING id`,
    [
      `shop-alipay-buyer-${stamp}@example.com`,
      await hashPassword("ShopTest123!"),
      `ALB${stamp.toString(36).toUpperCase()}`,
    ],
  );
  const buyerId = buyer.rows[0].id;

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

  const order = await createShopOrder({
    userId: buyerId,
    productId: item.id,
    expectedPriceMicros: Number(item.price_micros),
    paymentProvider: "alipay_manual",
    customerInput,
  });

  const payment = await query<{ order_kind: string; payee: string }>(
    "SELECT order_kind, payee FROM manual_alipay_payments WHERE order_id = $1",
    [order.id],
  );
  assert(payment.rows[0]?.order_kind === "shop", "shop manual alipay row missing");
  assert(payment.rows[0].payee === "CokeAI Test", "payee snapshot mismatch");

  const providerRef = `ALPAY${stamp}`;
  await markShopOrderPaid({
    orderNo: order.orderNo,
    provider: "alipay_manual",
    providerRef,
    paidAmountMicros: order.amountMicros,
    adminId,
    note: "manual alipay e2e",
  });

  const paid = await findShopOrderByNo(order.orderNo, buyerId);
  assert(paid?.status === "paid", "manual alipay order not paid");
  assert(paid.payment_provider === "alipay_manual", "provider not alipay_manual");
  assert(paid.provider_ref === providerRef, "provider ref not stored");

  const receipt = await query<{ order_kind: string; provider: string; amount_micros: string }>(
    "SELECT order_kind, provider, amount_micros FROM payment_receipts WHERE order_id = $1",
    [order.id],
  );
  assert(receipt.rows[0]?.order_kind === "shop", "shop receipt missing");
  assert(receipt.rows[0].provider === "personal_alipay", "receipt provider mismatch");
  assert(Number(receipt.rows[0].amount_micros) === order.amountMicros, "receipt amount mismatch");

  console.log(
    JSON.stringify(
      {
        ok: true,
        order: order.orderNo,
        payee: payment.rows[0].payee,
        receipt: receipt.rows[0].provider,
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
