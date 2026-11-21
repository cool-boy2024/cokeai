import { createHash } from "node:crypto";
import { loadEnv } from "./env.mjs";

loadEnv();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function md5(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function sign(params: Record<string, string>, key: string): string {
  const mode = (process.env.EASYPAY_SIGN_MODE || "sorted").toLowerCase();
  if (mode === "concat") {
    const order = [
      "pid",
      "type",
      "out_trade_no",
      "notify_url",
      "return_url",
      "name",
      "money",
      "sitename",
    ];
    return md5(order.map((name) => params[name] || "").join("") + key);
  }
  const entries = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return md5(entries.map(([name, value]) => `${name}=${value}`).join("&") + key);
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");
  const { config } = await import("../src/lib/config");
  const { createShopOrder, findShopOrderByNo } = await import("../src/lib/shop/orders");
  const { POST } = await import("../src/app/api/webhooks/easypay/shop/route");

  assert(config.easypayKey, "EASYPAY_KEY is not configured");
  assert(config.easypayPid, "EASYPAY_PID is not configured");

  const user = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'Easypay Shop Test', $3) RETURNING id`,
    [
      `shop-easypay-${Date.now()}@example.com`,
      await hashPassword("ShopTest123!"),
      `PAY${Date.now().toString(36).toUpperCase()}`,
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

  const order = await createShopOrder({
    userId,
    productId: item.id,
    expectedPriceMicros: Number(item.price_micros),
    paymentProvider: "alipay_easypay",
    customerInput,
  });

  const tradeNo = `TEST${Date.now()}`;
  const params: Record<string, string> = {
    pid: config.easypayPid,
    type: config.easypayAlipayType,
    out_trade_no: order.orderNo,
    trade_no: tradeNo,
    name: "CokeAI小店-测试商品",
    money: (order.amountMicros / 1_000_000).toFixed(2),
    trade_status: "TRADE_SUCCESS",
    sign_type: "MD5",
  };
  params.sign = sign(params, config.easypayKey);

  const body = new URLSearchParams(params).toString();
  const request = () =>
    new Request("http://localhost/api/webhooks/easypay/shop", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

  const first = await POST(request());
  assert(first.status === 200 && (await first.text()) === "success", "first callback failed");
  const paid = await findShopOrderByNo(order.orderNo, userId);
  assert(paid?.status === "paid", "order not marked paid");

  const second = await POST(request());
  assert(second.status === 200 && (await second.text()) === "success", "duplicate callback failed");
  const events = await query<{ status: string }>(
    `SELECT status FROM shop_payment_events WHERE provider = 'easypay' AND event_id LIKE $1`,
    [`${order.orderNo}%`],
  );
  assert(events.rows.length === 1 && events.rows[0].status === "processed", "event not idempotent");

  // Wrong amount must be acknowledged but not fulfilled.
  const order2 = await createShopOrder({
    userId,
    productId: item.id,
    expectedPriceMicros: Number(item.price_micros),
    paymentProvider: "alipay_easypay",
    customerInput,
  });
  const badParams: Record<string, string> = {
    ...params,
    out_trade_no: order2.orderNo,
    trade_no: `BAD${Date.now()}`,
    money: "0.01",
  };
  badParams.sign = sign(badParams, config.easypayKey);
  const bad = await POST(
    new Request("http://localhost/api/webhooks/easypay/shop", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(badParams).toString(),
    }),
  );
  assert(bad.status === 200 && (await bad.text()) === "success", "bad amount should be acked");
  const stillPending = await findShopOrderByNo(order2.orderNo, userId);
  assert(stillPending?.status === "pending_payment", "wrong amount filled the order");

  console.log(
    JSON.stringify({
      ok: true,
      order: order.orderNo,
      duplicate_events: events.rows.length,
      wrong_amount_status: stillPending.status,
    }),
    null,
    2,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
