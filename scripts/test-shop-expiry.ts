import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

// Deliberately do not load .env: this test must be pointed at a local test DB.
// Every table lives in a random schema, with no public-schema fallback.
async function main() {
  const rawUrl = process.env.TEST_DATABASE_URL;
  assert(rawUrl, "Set TEST_DATABASE_URL to a disposable local PostgreSQL database");
  const url = new URL(rawUrl);
  assert(["postgres:", "postgresql:"].includes(url.protocol), "Expected a PostgreSQL URL");
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "Expiry regression tests only accept a loopback database host",
  );
  assert(!url.search && !url.hash, "Use a plain local database URL without connection overrides");

  const schema = `shop_expiry_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  const app = new Pool({
    connectionString: url.toString(),
    max: 1,
    options: `-c search_path=${schema}`,
  });
  let schemaCreated = false;
  const globals = globalThis as unknown as { cokeaiPool?: Pool };
  assert(!globals.cokeaiPool, "Run this test in a fresh process");

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    globals.cokeaiPool = app;
    const current = await app.query<{ current_schema: string }>("SELECT current_schema()");
    assert.equal(current.rows[0].current_schema, schema, "Database search path is not isolated");
    await app.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));

    const { expireShopOrders } = await import("../src/lib/shop/orders");
    const user = await app.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, referral_code)
       VALUES ('expiry@example.test', 'not-a-login-hash', 'Expiry test', 'EXPIRY') RETURNING id`,
    );

    type Fixture = {
      name: string;
      orderMinutes?: number;
      paymentMinutes?: number | null;
      provider?: "usdt_trc20" | "manual";
      orderStatus?: string;
      depositStatus?: string | null;
      received?: number;
      expires?: boolean;
    };
    const fixtures: Fixture[] = [
      // Regression: the old checkout kept the order alive 24 h beyond its quote.
      { name: "legacy_24h_order", orderMinutes: 24 * 60, paymentMinutes: -60, expires: true },
      { name: "current_expired_order", expires: true },
      { name: "missing_payment_deadline_falls_back", paymentMinutes: null, expires: true },
      { name: "future_payment_deadline", orderMinutes: 60, paymentMinutes: 60 },
      { name: "missing_deadline_future_order", orderMinutes: 60, paymentMinutes: null },
      { name: "scanner_waiting", depositStatus: "waiting" },
      { name: "scanner_partial", depositStatus: "partial" },
      { name: "scanner_confirming", depositStatus: "confirming" },
      { name: "scanner_manual_review", depositStatus: "manual" },
      { name: "scanner_confirmed", depositStatus: "confirmed" },
      { name: "scanner_overpaid", depositStatus: "overpaid" },
      { name: "expired_but_has_funds", received: 0.25 },
      { name: "partial_with_funds", depositStatus: "partial", received: 0.25 },
      { name: "confirming_with_funds", depositStatus: "confirming", received: 1 },
      { name: "checkout_without_deposit", depositStatus: null, expires: true },
      { name: "manual_expired", provider: "manual", depositStatus: null, expires: true },
      {
        name: "manual_ignores_usdt_quote",
        provider: "manual", depositStatus: null, orderMinutes: 60, paymentMinutes: -60,
      },
      ...["paid", "procuring", "delivered", "cancelled", "expired", "refund_pending", "refunded"].map(
        (orderStatus) => ({ name: `already_${orderStatus}`, orderStatus }),
      ),
    ];
    const ids = new Map<string, string>();
    for (const [index, fixture] of fixtures.entries()) {
      const result = await app.query<{ id: string }>(
        `INSERT INTO shop_orders
         (order_no, user_id, status, payment_provider, expires_at, pay_expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5),
                 CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(mins => $6) END)
         RETURNING id`,
        [fixture.name, user.rows[0].id, fixture.orderStatus ?? "pending_payment",
          fixture.provider ?? "usdt_trc20", fixture.orderMinutes ?? -60,
          fixture.paymentMinutes === undefined ? -60 : fixture.paymentMinutes],
      );
      ids.set(fixture.name, result.rows[0].id);
      if (fixture.depositStatus !== null) {
        await app.query(
          `INSERT INTO shop_usdt_deposits
           (order_id, address, derivation_index, expected_usdt, received_usdt, status, expires_at)
           VALUES ($1, $2, $3, 1, $4, $5, now() + make_interval(mins => $6))`,
          [result.rows[0].id, `test-address-${index}`, index, fixture.received ?? 0,
            fixture.depositStatus ?? "expired", fixture.paymentMinutes ?? -60],
        );
      }
    }

    const expectedExpired = fixtures.filter((fixture) => fixture.expires).length;
    const expired = await expireShopOrders();
    const orders = await app.query<{ order_no: string; status: string }>(
      "SELECT order_no, status FROM shop_orders",
    );
    const states = new Map(orders.rows.map((row) => [row.order_no, row.status]));
    for (const fixture of fixtures) {
      assert.equal(states.get(fixture.name), fixture.expires ? "expired" : fixture.orderStatus ?? "pending_payment",
        `${fixture.name}: unexpected order status`);
    }
    assert.equal(expired, expectedExpired, "Unexpected number of expired orders");
    const events = await app.query<{ order_id: string; event: string }>(
      "SELECT order_id, event FROM shop_order_events",
    );
    assert.equal(events.rows.length, expectedExpired, "Each expired order needs exactly one event");
    for (const fixture of fixtures) {
      assert.equal(
        events.rows.filter((row) => row.order_id === ids.get(fixture.name) && row.event === "expired").length,
        fixture.expires ? 1 : 0, `${fixture.name}: incorrect expiry events`,
      );
    }
    assert.equal(await expireShopOrders(), 0, "Repeated cleanup must be idempotent");
    const repeatedEvents = await app.query<{ count: string }>("SELECT count(*) FROM shop_order_events");
    assert.equal(Number(repeatedEvents.rows[0].count), expectedExpired, "Repeated cleanup added events");

    console.log(JSON.stringify({ ok: true, cases: fixtures.length, expired, idempotent: true }));
  } finally {
    delete globals.cokeaiPool;
    await app.end();
    try {
      if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Expiry regression test failed");
  process.exitCode = 1;
});
