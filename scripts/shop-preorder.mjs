#!/usr/bin/env node
/**
 * Turn the operator-forced preorder switch on or off for one product.
 *
 *   node scripts/shop-preorder.mjs <slug> [on|off]
 *
 * Run it inside the app container (or locally with DATABASE_URL set):
 *
 *   docker compose exec -T app node scripts/shop-preorder.mjs zy-84-chatgpt-gpt-plus on
 *
 * The switch lives in shop_products.preorder_manual, a column supplier syncs
 * never write, so it survives stock refreshes. The admin product page exposes
 * the same switch; this script exists for one-off operations without a login.
 */
import pg from "pg";
import { loadEnv } from "./env.mjs";

loadEnv();

const [slug, mode = "on"] = process.argv.slice(2);
if (!slug || !["on", "off"].includes(mode)) {
  console.error("Usage: node scripts/shop-preorder.mjs <slug> [on|off]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15_000,
});

try {
  const result = await pool.query(
    `UPDATE shop_products
        SET preorder_manual = $2, updated_at = now()
      WHERE slug = $1
      RETURNING slug, name, preorder_manual`,
    [slug, mode === "on"],
  );
  if (result.rowCount === 0) {
    console.error(`No product with slug ${slug}`);
    process.exitCode = 1;
  } else {
    const row = result.rows[0];
    console.log(
      `${row.slug} preorder_manual=${row.preorder_manual ? "true" : "false"} (${row.name})`,
    );
  }
} finally {
  await pool.end();
}
