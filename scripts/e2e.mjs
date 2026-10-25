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
  assert(badKey.response.status === 401, "invalid API key rejected");

  const models = await jsonFetch("/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert(models.response.status === 200, "model list status");
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
  assert(completion.response.status === 200, "non-stream completion succeeds");
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
  assert(streamResponse.status === 200, "stream request status");
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

  console.log("E2E smoke tests passed:");
  console.log("- health, auth, model list");
  console.log("- non-stream and stream billing");
  console.log("- Stripe webhook fulfillment and idempotency");
  console.log("- referral commission");
  console.log("- internal secret and hard budget");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
