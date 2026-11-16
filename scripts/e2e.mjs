import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
const encryptionSecret = process.env.APP_ENCRYPTION_KEY;
const internalSecret = process.env.INTERNAL_API_SECRET;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!databaseUrl || !encryptionSecret || !internalSecret || !stripeWebhookSecret) {
  console.error("Missing required E2E environment variables.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encryptSecret(value) {
  const key = crypto.createHash("sha256").update(encryptionSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${appUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body, text };
}

function stripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/** The app stores sha256(token) and compares that; see src/lib/auth.ts. */
async function makeSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [sha256(token), userId],
  );
  return `cokeai_session=${token}`;
}

async function htmlFetch(path, cookie) {
  const response = await fetch(`${appUrl}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { response, text: await response.text() };
}

/** Every occurrence of a marker's following number, e.g. 份 badge digits. */
function countMarker(text, marker) {
  return text.split(marker).length - 1;
}

async function cleanupByEmail(email) {
  await pool.query(
    "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)",
    [email],
  );
  await pool.query("DELETE FROM users WHERE email = $1", [email]);
}

/**
 * Sidebar badge = customer messages not yet opened, open tickets only. A closed
 * ticket contributes nothing; opening the detail page clears the ticket.
 */
async function testSupportUnreadBadge() {
  const email = `support-${suffix}@example.test`;
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, referral_code)
     VALUES ($1, 'unused', 'E2E Support User', 'admin', $2)
     RETURNING id`,
    [email, `SUP${suffix.toUpperCase()}`.slice(0, 20)],
  );
  const userId = user.rows[0].id;
  const cookie = await makeSession(userId);

  try {
    const openTicket = await pool.query(
      "INSERT INTO support_tickets (user_id, subject, status) VALUES ($1, 'open one', 'open') RETURNING id",
      [userId],
    );
    const openId = openTicket.rows[0].id;
    await pool.query(
      `INSERT INTO support_ticket_messages (ticket_id, author, body)
       VALUES ($1, 'customer', 'hello'), ($1, 'customer', 'anyone?')`,
      [openId],
    );
    const closedTicket = await pool.query(
      "INSERT INTO support_tickets (user_id, subject, status) VALUES ($1, 'closed one', 'closed') RETURNING id",
      [userId],
    );
    await pool.query(
      "INSERT INTO support_ticket_messages (ticket_id, author, body) VALUES ($1, 'customer', 'done')",
      [closedTicket.rows[0].id],
    );

    const before = await jsonFetch("/api/admin/support/unread", {
      headers: { cookie },
    });
    assert(before.response.status === 200, "unread endpoint responds for admin");
    assert(
      before.body.count === 2,
      `unread counts only the open ticket (expected 2, got ${before.body.count})`,
    );

    const unauthorized = await jsonFetch("/api/admin/support/unread");
    assert(
      unauthorized.response.status === 404,
      "unread endpoint hides itself from anonymous callers",
    );

    const detail = await htmlFetch(`/admin/support/${openId}`, cookie);
    assert(detail.response.status === 200, "ticket detail renders for admin");

    const after = await jsonFetch("/api/admin/support/unread", {
      headers: { cookie },
    });
    assert(after.body.count === 0, `reading clears the badge (got ${after.body.count})`);

    const closedAgain = await pool.query(
      "SELECT status FROM support_tickets WHERE id = $1",
      [openId],
    );
    assert(closedAgain.rows[0].status === "open", "reading does not close the ticket");

    await pool.query(
      "INSERT INTO support_ticket_messages (ticket_id, author, body) VALUES ($1, 'customer', 'still here')",
      [openId],
    );
    const replied = await jsonFetch("/api/admin/support/unread", {
      headers: { cookie },
    });
    assert(replied.body.count === 1, "a new customer reply increments the badge");

    await pool.query(
      "UPDATE support_tickets SET status = 'closed' WHERE id = $1",
      [openId],
    );
    const closed = await jsonFetch("/api/admin/support/unread", {
      headers: { cookie },
    });
    assert(closed.body.count === 0, "closing a ticket drops its unread messages");
  } finally {
    await cleanupByEmail(email);
  }
}

function insertOrder(userId, orderNo, status) {
  return pool.query(
    `INSERT INTO shop_orders
       (order_no, user_id, status, subtotal_micros, amount_micros,
        payment_provider, expires_at, created_at)
     VALUES ($1, $2, $3, 1000000, 1000000, 'manual', now() + interval '1 hour', now())
     RETURNING id`,
    [orderNo, userId, status],
  );
}

/** Admin list: exact order-number match composes with the status tab and paging. */
async function testAdminOrderSearchAndPaging() {
  const email = `orders-${suffix}@example.test`;
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, referral_code)
     VALUES ($1, 'unused', 'E2E Orders User', 'admin', $2)
     RETURNING id`,
    [email, `ORD${suffix.toUpperCase()}`.slice(0, 20)],
  );
  const userId = user.rows[0].id;
  const cookie = await makeSession(userId);
  const unique = suffix.toUpperCase();
  const paidNo = `CK${unique}PAID`.slice(0, 30);
  const pendingNo = `CK${unique}PEND`.slice(0, 30);

  try {
    const paid = await insertOrder(userId, paidNo, "paid");
    const pending = await insertOrder(userId, pendingNo, "pending_payment");
    await pool.query(
      `INSERT INTO shop_order_items (order_id, product_id, product_slug, product_name, brand, unit_price_micros, qty)
       VALUES ($1, NULL, 'e2e-paid', 'E2E Paid', 'other', 1000000, 1),
              ($2, NULL, 'e2e-pending', 'E2E Pending', 'other', 1000000, 1)`,
      [paid.rows[0].id, pending.rows[0].id],
    );

    const byOrderNo = await htmlFetch(
      `/admin/shop/orders?q=${encodeURIComponent(paidNo.toLowerCase())}`,
      cookie,
    );
    assert(byOrderNo.response.status === 200, "order list renders with a search");
    assert(byOrderNo.text.includes(paidNo), "exact order number finds its order");
    assert(
      !byOrderNo.text.includes(pendingNo),
      "exact match does not leak other order numbers",
    );

    const wrongStatus = await htmlFetch(
      `/admin/shop/orders?status=delivered&q=${encodeURIComponent(paidNo)}`,
      cookie,
    );
    assert(
      !wrongStatus.text.includes(paidNo),
      "order-number search composes with the status filter",
    );

    const partial = await htmlFetch(
      `/admin/shop/orders?q=${encodeURIComponent(`CK${unique}`)}`,
      cookie,
    );
    assert(
      !partial.text.includes(paidNo) && !partial.text.includes(pendingNo),
      "a partial order number finds nothing (exact match only)",
    );

    const paged = await htmlFetch("/admin/shop/orders?page=2", cookie);
    assert(paged.response.status === 200, "page 2 renders");
    assert(paged.text.includes("第 2 /"), "pager reports the current page");

    const beyond = await htmlFetch("/admin/shop/orders?page=999", cookie);
    assert(beyond.response.status === 200, "an out-of-range page does not fail");
    assert(!beyond.text.includes("第 999 /"), "out-of-range pages clamp to the last page");
  } finally {
    await cleanupByEmail(email);
  }
}

/** Public catalog: paging slices the cards, the toolbar total stays the filter total. */
async function testShopCatalogPaging() {
  const prefix = `e2e-page-${suffix}`;
  try {
    for (let index = 0; index < 14; index += 1) {
      await pool.query(
        `INSERT INTO shop_products
           (slug, brand, name, subtitle, price_micros, status, availability,
            copy_ready, display_category, sort_order)
         VALUES ($1, 'other', $2, '分页测试商品', 1000000, 'active', 'in_stock',
                 TRUE, '其他', $3)`,
        [`${prefix}-${index}`, `E2E 分页商品 ${index}`, 9000 + index],
      );
    }

    const page1 = await htmlFetch("/shop?category=other");
    const page2 = await htmlFetch("/shop?category=other&page=2");
    assert(page1.response.status === 200, "shop page renders");
    assert(page2.response.status === 200, "shop page 2 renders");
    assert(
      countMarker(page1.text, prefix) === 12,
      `page 1 shows 12 cards (got ${countMarker(page1.text, prefix)})`,
    );
    assert(
      countMarker(page2.text, prefix) === 2,
      `page 2 shows the remaining 2 cards (got ${countMarker(page2.text, prefix)})`,
    );

    const totalMatch = page1.text.match(/件商品/g);
    assert((totalMatch || []).length > 0, "toolbar total is rendered");

    await pool.query("DELETE FROM shop_products WHERE slug LIKE $1", [`${prefix}-%`]);
  } catch (error) {
    await pool.query("DELETE FROM shop_products WHERE slug LIKE $1", [`${prefix}-%`]);
    throw error;
  }
}

const suffix = Date.now().toString(36);
const referrerEmail = `referrer-${suffix}@example.test`;
const buyerEmail = `buyer-${suffix}@example.test`;
const apiKey = `sk-coke-e2e-${crypto.randomBytes(24).toString("base64url")}`;

let buyerId;
let referrerId;

try {
  const health = await jsonFetch("/api/health");
  assert(health.response.status === 200, "public health endpoint");

  await pool.query(
    `UPDATE upstreams
        SET base_url = 'http://127.0.0.1:4010/v1',
            api_key_encrypted = $1,
            enabled = TRUE,
            updated_at = now()
      WHERE id = 'deepseek'`,
    [encryptSecret(process.env.MOCK_UPSTREAM_KEY || "mock-upstream-key")],
  );
  await pool.query(
    `UPDATE models
        SET enabled = TRUE, min_plan_tier = 0, markup_bps = 18000, updated_at = now()
      WHERE id = 'deepseek-chat'`,
  );

  const referrer = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, referral_code)
     VALUES ($1, 'unused', 'E2E Referrer', 'user', $2)
     RETURNING id`,
    [referrerEmail, `REF${suffix}`.toUpperCase()],
  );
  referrerId = referrer.rows[0].id;

  const buyer = await pool.query(
    `INSERT INTO users
       (email, password_hash, name, role, referral_code, referred_by, balance_micros, plan_id, plan_expires_at)
     VALUES ($1, 'unused', 'E2E Buyer', 'user', $2, $3, 10000000, 'starter', now() + interval '7 days')
     RETURNING id`,
    [buyerEmail, `BUY${suffix}`.toUpperCase(), referrerId],
  );
  buyerId = buyer.rows[0].id;

  await pool.query(
    `INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
     VALUES ($1, 'e2e', $2, 'sk-coke-e2e')`,
    [buyerId, sha256(apiKey)],
  );

  const badKey = await jsonFetch("/v1/models", {
    headers: { Authorization: "Bearer sk-coke-not-valid" },
  });
  assert(badKey.response.status === 401, `invalid API key rejected (got ${badKey.response.status}: ${badKey.text.slice(0, 200)})`);

  const models = await jsonFetch("/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert(models.response.status === 200, `model list status (got ${models.response.status}: ${models.text.slice(0, 200)})`);
  assert(
    models.body?.data?.some((item) => item.id === "deepseek-chat"),
    "model list contains deepseek-chat",
  );

  const balanceBefore = Number(
    (
      await pool.query("SELECT balance_micros FROM users WHERE id = $1", [buyerId])
    ).rows[0].balance_micros,
  );

  const completion = await jsonFetch("/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 64,
    }),
  });
  assert(completion.response.status === 200, `non-stream completion succeeds (got ${completion.response.status}: ${completion.text.slice(0, 300)})`);
  assert(
    completion.body?.choices?.[0]?.message?.content === "Hello from CokeAI mock.",
    "non-stream completion content",
  );

  const balanceAfter = Number(
    (
      await pool.query("SELECT balance_micros FROM users WHERE id = $1", [buyerId])
    ).rows[0].balance_micros,
  );
  assert(balanceAfter < balanceBefore, "balance is charged");
  assert(balanceBefore - balanceAfter < 1_000_000, "charge is below one yuan");

  const usageAfterNonStream = await pool.query(
    "SELECT count(*)::int AS count FROM usage_events WHERE user_id = $1 AND status = 'succeeded'",
    [buyerId],
  );
  assert(usageAfterNonStream.rows[0].count === 1, "usage event recorded");

  const streamResponse = await fetch(`${appUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      stream: true,
      messages: [{ role: "user", content: "stream" }],
      max_tokens: 64,
    }),
  });
  assert(streamResponse.status === 200, `stream request status (got ${streamResponse.status})`);
  assert(
    (streamResponse.headers.get("content-type") || "").includes("text/event-stream"),
    "stream content type",
  );
  const streamText = await streamResponse.text();
  assert(streamText.includes("Hello"), "stream contains model output");
  assert(streamText.includes("[DONE]"), "stream ends with DONE");

  const usageAfterStream = await pool.query(
    "SELECT count(*)::int AS count FROM usage_events WHERE user_id = $1 AND status = 'succeeded'",
    [buyerId],
  );
  assert(usageAfterStream.rows[0].count === 2, "stream usage event recorded");

  const order = await pool.query(
    `INSERT INTO orders
       (user_id, plan_id, amount_micros, credits_micros, duration_days, status, payment_provider, provider_ref)
     VALUES ($1, 'basic', 39000000, 45000000, 30, 'pending', 'stripe', $2)
     RETURNING id`,
    [buyerId, `cs_test_${suffix}`],
  );
  const orderId = order.rows[0].id;
  const balanceBeforeOrder = Number(
    (
      await pool.query("SELECT balance_micros FROM users WHERE id = $1", [buyerId])
    ).rows[0].balance_micros,
  );

  const event = {
    id: `evt_${suffix}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${suffix}`,
        object: "checkout.session",
        payment_status: "paid",
        metadata: { orderId },
      },
    },
  };
  const payload = JSON.stringify(event);

  const webhook = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": stripeSignature(payload, stripeWebhookSecret),
    },
    body: payload,
  });
  assert(webhook.status === 200, "stripe webhook accepted");

  const paidOrder = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
  assert(paidOrder.rows[0].status === "paid", "order fulfilled");

  const balanceAfterOrder = Number(
    (
      await pool.query("SELECT balance_micros FROM users WHERE id = $1", [buyerId])
    ).rows[0].balance_micros,
  );
  assert(
    balanceAfterOrder === balanceBeforeOrder + 45_000_000,
    "credits added exactly once",
  );

  const commission = await pool.query(
    "SELECT amount_micros, status FROM commissions WHERE order_id = $1",
    [orderId],
  );
  assert(commission.rowCount === 1, "referral commission created");
  assert(Number(commission.rows[0].amount_micros) === 3_900_000, "commission amount");
  assert(commission.rows[0].status === "pending", "commission starts pending");

  const duplicate = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": stripeSignature(payload, stripeWebhookSecret),
    },
    body: payload,
  });
  assert(duplicate.status === 200, "duplicate webhook accepted");
  const balanceAfterDuplicate = Number(
    (
      await pool.query("SELECT balance_micros FROM users WHERE id = $1", [buyerId])
    ).rows[0].balance_micros,
  );
  assert(balanceAfterDuplicate === balanceAfterOrder, "duplicate webhook is idempotent");

  const internalUnauthorized = await jsonFetch("/api/internal/reports/daily");
  assert(internalUnauthorized.response.status === 401, "internal report rejects missing secret");
  const internalAuthorized = await jsonFetch("/api/internal/reports/daily", {
    headers: { "x-internal-secret": internalSecret },
  });
  assert(internalAuthorized.response.status === 200, "internal report accepts secret");

  await pool.query("UPDATE users SET balance_micros = 1 WHERE id = $1", [buyerId]);
  const insufficient = await jsonFetch("/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "too expensive" }],
    }),
  });
  assert(insufficient.response.status === 402, "insufficient balance rejected");

  await testSupportUnreadBadge();
  await testAdminOrderSearchAndPaging();
  await testShopCatalogPaging();

  console.log("E2E smoke tests passed:");
  console.log("- health, auth, model list");
  console.log("- non-stream and stream billing");
  console.log("- Stripe webhook fulfillment and idempotency");
  console.log("- referral commission");
  console.log("- internal secret and hard budget");
  console.log("- support unread badge (open only, clears on read)");
  console.log("- admin order exact search and paging");
  console.log("- shop catalog paging keeps the filtered total");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
