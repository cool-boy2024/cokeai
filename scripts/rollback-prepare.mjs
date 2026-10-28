#!/usr/bin/env node
/**
 * Prepare CokeAI's legacy gateway for an emergency rollback away from Sub2API.
 *
 * For every active gateway identity it:
 *   1. reads the user's Sub2API balance through the admin API;
 *   2. writes users.balance_micros = round(balance * 1,000,000);
 *   3. extends users.plan_expires_at to at least now() + 90 days so the legacy
 *      gateway's `plan_expires_at > now()` admission check passes.
 *
 * Usage:
 *   node scripts/rollback-prepare.mjs --dry-run
 *   node scripts/rollback-prepare.mjs
 *
 * Environment:
 *   DATABASE_URL            CokeAI PostgreSQL (must be reachable from where this runs)
 *   SUB2API_INTERNAL_URL    default http://127.0.0.1:18080
 *   SUB2API_ADMIN_EMAIL
 *   SUB2API_ADMIN_PASSWORD
 *
 * The Sub2API administrator compliance acknowledgement is a legal step. If it is
 * still outstanding, this script prints instructions and exits without writing.
 *
 * Secrets are never printed.
 */

import pg from "pg";
import { loadEnv } from "./env.mjs";

const { Pool } = pg;

loadEnv();

const dryRun = process.argv.includes("--dry-run");
const base = (process.env.SUB2API_INTERNAL_URL || "http://127.0.0.1:18080").replace(/\/+$/, "");
const adminEmail = process.env.SUB2API_ADMIN_EMAIL || "";
const adminPassword = process.env.SUB2API_ADMIN_PASSWORD || "";
const databaseUrl = process.env.DATABASE_URL || "";
const timeoutMs = Number.parseInt(process.env.SUB2API_TIMEOUT_MS || "10000", 10);
const fallbackDays = 90;

let exitCode = 0;

function ok(message) {
  console.log(`[ok]   ${message}`);
}

function warn(message) {
  console.warn(`[warn] ${message}`);
}

function failed(message) {
  console.error(`[fail] ${message}`);
  exitCode = 1;
}

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, options = {}) {
  const { method = "GET", token, body, timeout = timeoutMs } = options;
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new Error(`cannot reach ${base}${path}: ${error instanceof Error ? error.message : "network error"}`);
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, headers: response.headers, text, json };
}

function unwrap(response, label) {
  if (!response.ok) {
    const message = response.json?.message || response.json?.reason || `HTTP ${response.status}`;
    throw new ApiError(`${label} failed: ${message}`, response.status, response.json);
  }
  if (response.json && typeof response.json === "object" && "code" in response.json) {
    if (response.json.code !== 0) {
      const message = response.json.message || response.json.reason || "unknown error";
      throw new ApiError(`${label} failed: ${message}`, response.status, response.json);
    }
    return response.json.data;
  }
  return response.json;
}

function complianceRequired(response) {
  const payload = response.json || {};
  const code = payload.code ?? payload.reason;
  return (
    response.status === 423 ||
    code === "ADMIN_COMPLIANCE_ACK_REQUIRED" ||
    (response.status === 200 && payload.data?.required === true)
  );
}

function printComplianceInstructions(response) {
  const payload = response.json || {};
  const meta = payload.metadata || {};
  const data = payload.data || {};
  console.error("");
  console.error("[fail] Sub2API administrator compliance acknowledgement is required.");
  console.error("");
  console.error("This is a LEGAL acknowledgement. A human Sub2API administrator must");
  console.error("read the documents and accept it. This script will NOT accept it.");
  console.error("");
  if (meta.version || data.version) {
    console.error(`  Compliance version: ${meta.version || data.version}`);
  }
  console.error(
    `  Chinese document:   ${meta.document_url_zh || data.document_url_zh || "docs/legal/admin-compliance.zh.md"}`,
  );
  console.error(
    `  English document:   ${meta.document_url_en || data.document_url_en || "docs/legal/admin-compliance.en.md"}`,
  );
  console.error("");
  console.error("Open the admin UI through an SSH tunnel:");
  console.error("  ssh -L 18080:127.0.0.1:18080 <user>@<vps>");
  console.error("  http://127.0.0.1:18080/");
  console.error("Accept the acknowledgement there, then re-run this script.");
  console.error("");
}

async function login() {
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  });
  if (!response.ok) {
    const message = response.json?.message || response.json?.reason || `HTTP ${response.status}`;
    throw new Error(`admin login failed: ${message}`);
  }
  const data = unwrap(response, "admin login");
  if (data?.requires_2fa) {
    throw new Error(
      "admin login requires TOTP 2FA. Use a dedicated automation admin without 2FA, or perform the balance export manually.",
    );
  }
  if (!data?.access_token) throw new Error("admin login did not return access_token");
  return data.access_token;
}

async function ensureCompliance(token) {
  const response = await request("/api/v1/admin/compliance", { token });
  if (complianceRequired(response)) {
    printComplianceInstructions(response);
    return false;
  }
  if (!response.ok) {
    throw new ApiError(
      `compliance status check failed: ${response.json?.message || response.json?.reason || `HTTP ${response.status}`}`,
      response.status,
      response.json,
    );
  }
  const status = unwrap(response, "compliance status");
  if (status?.required) {
    printComplianceInstructions({ json: { data: status } });
    return false;
  }
  return true;
}

async function main() {
  if (!databaseUrl) {
    console.error("DATABASE_URL is required. Run this inside the app container or export a reachable URL.");
    process.exit(2);
  }
  if (!adminEmail || !adminPassword) {
    console.error("SUB2API_ADMIN_EMAIL and SUB2API_ADMIN_PASSWORD are required.");
    process.exit(2);
  }

  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "WRITE"}`);
  console.log(`CokeAI database: ${new URL(databaseUrl).host}`);
  console.log(`Sub2API target:  ${base}`);
  console.log("");

  let token;
  try {
    token = await login();
    ok("admin login succeeded");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "admin login failed");
    process.exit(1);
  }

  try {
    if (!(await ensureCompliance(token))) process.exit(1);
    ok("admin compliance acknowledged");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "compliance check failed");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  let processed = 0;
  let updated = 0;
  let planned = 0;
  let errors = 0;
  let clamped = 0;

  try {
    const identities = await pool.query(
      `SELECT gi.user_id::text AS user_id,
              gi.sub2api_user_id,
              u.email,
              u.status,
              u.balance_micros::text AS balance_micros,
              u.plan_expires_at
         FROM gateway_identities gi
         JOIN users u ON u.id = gi.user_id
        WHERE gi.state = 'active'
          AND gi.sub2api_user_id IS NOT NULL
        ORDER BY u.email`,
    );

    if (identities.rowCount === 0) {
      console.log("No active gateway identities found; nothing to do.");
      return;
    }

    const now = Date.now();
    const minimumExpiry = new Date(now + fallbackDays * 24 * 60 * 60 * 1000);

    for (const identity of identities.rows) {
      processed += 1;
      const sub2apiUserId = Number(identity.sub2api_user_id);
      const label = `${identity.email} (sub2api#${sub2apiUserId})`;

      try {
        const response = await request(`/api/v1/admin/users/${sub2apiUserId}`, { token });
        if (complianceRequired(response)) {
          printComplianceInstructions(response);
          failed(`compliance acknowledgement is required; stopped before writing ${label}`);
          break;
        }
        const remote = unwrap(response, `read Sub2API user ${sub2apiUserId}`);
        const balance = Number(remote?.balance);
        if (!Number.isFinite(balance)) {
          failed(`${label}: Sub2API returned a non-numeric balance`);
          errors += 1;
          continue;
        }

        let micros = Math.round(balance * 1_000_000);
        if (micros < 0) {
          clamped += 1;
          warn(`${label}: negative Sub2API balance ${balance}; clamped to 0 micros (users table CHECK)`);
          micros = 0;
        }

        const currentExpiry = identity.plan_expires_at
          ? new Date(identity.plan_expires_at)
          : null;
        const targetExpiry =
          currentExpiry && currentExpiry.getTime() > minimumExpiry.getTime()
            ? currentExpiry
            : minimumExpiry;

        if (dryRun) {
          planned += 1;
          console.log(
            `[plan] ${label}: balance ${identity.balance_micros} -> ${micros} micros; expires ${targetExpiry.toISOString()}`,
          );
          continue;
        }

        const result = await pool.query(
          `UPDATE users
              SET balance_micros = $2,
                  plan_expires_at = GREATEST(
                    COALESCE(plan_expires_at, now()),
                    now() + ($3 || ' days')::interval
                  ),
                  updated_at = now()
            WHERE id = $1
            RETURNING balance_micros::text AS balance_micros,
                      plan_expires_at`,
          [identity.user_id, micros, String(fallbackDays)],
        );

        if (result.rowCount !== 1) {
          failed(`${label}: users row was not updated`);
          errors += 1;
          continue;
        }

        const row = result.rows[0];
        updated += 1;
        ok(
          `${label}: balance ${identity.balance_micros} -> ${row.balance_micros} micros; expires ${new Date(row.plan_expires_at).toISOString()}`,
        );
      } catch (error) {
        failed(`${label}: ${error instanceof Error ? error.message : "unknown error"}`);
        errors += 1;
      }
    }
  } finally {
    await pool.end();
  }

  console.log("");
  console.log("Rollback preparation summary");
  console.log(`  identities processed: ${processed}`);
  if (dryRun) {
    console.log(`  planned updates:      ${planned}`);
  } else {
    console.log(`  updated:              ${updated}`);
  }
  console.log(`  negative balances clamped: ${clamped}`);
  console.log(`  errors:               ${errors}`);
  if (dryRun) {
    console.log("");
    console.log("Dry run only. Re-run without --dry-run to write these values.");
  } else {
    console.log("");
    console.log("Next: switch the edge gateway upstream to app:3000 and run the legacy smoke test.");
  }

  if (errors > 0) exitCode = 1;
}

try {
  await main();
} catch (error) {
  failed(error instanceof Error ? error.message : "unexpected rollback-preparation error");
}

process.exit(exitCode);
