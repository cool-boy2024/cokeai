import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv } from "./env.mjs";

loadEnv();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 15_000,
});

try {
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Database schema is up to date.");
} finally {
  await pool.end();
}
