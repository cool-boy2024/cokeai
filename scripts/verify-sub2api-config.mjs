#!/usr/bin/env node
/**
 * Verify the production Sub2API gateway configuration.
 *
 * Usage:
 *   node scripts/verify-sub2api-config.mjs
 *   node scripts/verify-sub2api-config.mjs --allow-remote   # non-loopback internal URL
 *   node scripts/verify-sub2api-config.mjs --skip-public-check
 *
 * Environment:
 *   SUB2API_INTERNAL_URL      default http://127.0.0.1:18080
 *   SUB2API_ADMIN_EMAIL
 *   SUB2API_ADMIN_PASSWORD
 *   SUB2API_GROUP_ID
 *   APP_URL                   optional; used only for the public-exposure probe
 *
 * IMPORTANT: Sub2API requires a one-time administrator compliance
 * acknowledgement. That is a legal acknowledgement, so this script NEVER accepts
 * it automatically. It detects ADMIN_COMPLIANCE_ACK_REQUIRED, prints the exact
 * human instructions, and exits non-zero.
 *
 * Secrets (passwords, tokens, API keys) are never printed.
 */

import { loadEnv } from "./env.mjs";

loadEnv();

const base = (process.env.SUB2API_INTERNAL_URL || "http://127.0.0.1:18080").replace(/\/+$/, "");
const adminEmail = process.env.SUB2API_ADMIN_EMAIL || "";
const adminPassword = process.env.SUB2API_ADMIN_PASSWORD || "";
const groupId = Number.parseInt(process.env.SUB2API_GROUP_ID || "0", 10);
const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
const timeoutMs = Number.parseInt(process.env.SUB2API_TIMEOUT_MS || "10000", 10);
const allowRemote = process.argv.includes("--allow-remote");
const skipPublicCheck = process.argv.includes("--skip-public-check");

const failures = [];
const warnings = [];

function ok(message) {
  console.log(`[ok]   ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`[warn] ${message}`);
}

function failed(message) {
  failures.push(message);
  console.error(`[fail] ${message}`);
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
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`cannot reach ${base}${path}: ${reason}`);
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text,
    json,
  };
}

function unwrap(response, label) {
  if (!response.ok) {
    const message =
      response.json?.message ||
      response.json?.reason ||
      `HTTP ${response.status}`;
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

function complianceFromResponse(response) {
  const payload = response.json || {};
  const code = payload.code ?? payload.reason;
  const required =
    response.status === 423 ||
    code === "ADMIN_COMPLIANCE_ACK_REQUIRED" ||
    (response.status === 200 && payload.data?.required === true);
  if (!required) return null;
  const meta = payload.metadata || {};
  const data = payload.data || {};
  return {
    version: meta.version || data.version,
    documentUrlZh: meta.document_url_zh || data.document_url_zh,
    documentUrlEn: meta.document_url_en || data.document_url_en,
    ackPhraseZh: data.ack_phrase_zh,
    ackPhraseEn: data.ack_phrase_en,
  };
}

function printComplianceInstructions(info) {
  console.error("");
  console.error("[fail] Sub2API administrator compliance acknowledgement is required.");
  console.error("");
  console.error("This is a LEGAL acknowledgement. A human Sub2API administrator must read");
  console.error("the documents and accept it. This script will NOT accept it for you.");
  console.error("");
  if (info.version) console.error(`  Compliance version: ${info.version}`);
  console.error(`  Chinese document:   ${info.documentUrlZh || "docs/legal/admin-compliance.zh.md"}`);
  console.error(`  English document:   ${info.documentUrlEn || "docs/legal/admin-compliance.en.md"}`);
  console.error("");
  console.error("Steps:");
  console.error("  1. Open an SSH tunnel to the Sub2API admin UI:");
  console.error("       ssh -L 18080:127.0.0.1:18080 <user>@<vps>");
  console.error("       xdg-open http://127.0.0.1:18080/   (or open it in a browser)");
  console.error("  2. Read both compliance documents.");
  console.error("  3. Accept the acknowledgement in the admin UI. If you deliberately");
  console.error("     choose to do it with curl, a human must POST:");
  console.error(`       POST ${base}/api/v1/admin/compliance/accept`);
  console.error("       Authorization: Bearer <admin JWT>");
  console.error("       Content-Type: application/json");
  console.error(
    `       {"phrase":"${info.ackPhraseZh || "<exact phrase shown in the UI>"}","language":"zh"}`,
  );
  console.error("");
  console.error("Then re-run this verification script.");
}

function isPrivateOrLoopbackHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host.startsWith("127.")) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;
  return false;
}

function isOne(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value - 1) < 1e-9;
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
      "admin login requires TOTP 2FA. Use a dedicated automation admin without 2FA, or run the checks manually.",
    );
  }
  if (!data?.access_token) throw new Error("admin login did not return access_token");
  return data.access_token;
}

async function ensureCompliance(token) {
  const response = await request("/api/v1/admin/compliance", { token });
  const required = complianceFromResponse(response);
  if (required) {
    printComplianceInstructions(required);
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
    printComplianceInstructions({
      version: status.version,
      documentUrlZh: status.document_url_zh,
      documentUrlEn: status.document_url_en,
      ackPhraseZh: status.ack_phrase_zh,
      ackPhraseEn: status.ack_phrase_en,
    });
    return false;
  }
  ok(
    `admin compliance acknowledged${status?.acknowledgement?.version ? ` (version ${status.acknowledgement.version})` : ""}`,
  );
  return true;
}

async function listGroupAccounts(token) {
  const items = [];
  let page = 1;
  for (;;) {
    const response = await request(
      `/api/v1/admin/accounts?group=${groupId}&page=${page}&page_size=100`,
      { token },
    );
    const required = complianceFromResponse(response);
    if (required) {
      printComplianceInstructions(required);
      throw new Error("compliance acknowledgement required");
    }
    const data = unwrap(response, `list accounts page ${page}`);
    const batch = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    items.push(...batch);
    const total = Number(data?.total ?? items.length);
    if (batch.length === 0 || items.length >= total || page >= 50) break;
    page += 1;
  }
  return items;
}

async function checkPublicExposure() {
  if (skipPublicCheck) {
    warn("public-exposure probe skipped (--skip-public-check)");
    return;
  }
  if (!appUrl) {
    warn("APP_URL is unset; cannot probe public admin exposure");
    return;
  }

  const paths = ["/api/v1/admin/users", "/api/v1/admin/settings", "/api/v1/admin/compliance"];
  for (const path of paths) {
    let response;
    try {
      response = await fetch(`${appUrl}${path}`, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      warn(
        `could not probe ${appUrl}${path}: ${error instanceof Error ? error.message : "network error"}`,
      );
      continue;
    }
    const contentType = response.headers.get("content-type") || "";
    const mitigated = response.headers.get("cf-mitigated") || "";
    if (mitigated === "challenge") {
      warn(`public probe ${path} was challenged by Cloudflare; configure a WAF bypass for /v1/* only`);
      continue;
    }
    if (response.status === 200 || response.status === 401 || response.status === 403) {
      failed(
        `public path ${path} responded HTTP ${response.status} (${contentType || "no content-type"}); the edge must expose only /v1/* and /v1beta/* to Sub2API`,
      );
    } else {
      ok(`public admin path ${path} is not routed (HTTP ${response.status})`);
    }
  }
}

async function main() {
  console.log(`Sub2API verification target: ${base}`);
  if (!adminEmail || !adminPassword) {
    failed("SUB2API_ADMIN_EMAIL and SUB2API_ADMIN_PASSWORD are required");
    return;
  }
  if (!Number.isInteger(groupId) || groupId <= 0) {
    failed("SUB2API_GROUP_ID must be a positive integer");
    return;
  }

  let internalHost;
  try {
    internalHost = new URL(base).hostname;
  } catch {
    failed(`SUB2API_INTERNAL_URL is not a valid URL: ${base}`);
    return;
  }
  if (!isPrivateOrLoopbackHost(internalHost) && !allowRemote) {
    failed(
      `SUB2API_INTERNAL_URL (${internalHost}) is not loopback/private. Sub2API must not be publicly exposed. Use --allow-remote only for an explicitly firewalled private endpoint.`,
    );
  } else {
    ok(`internal URL host is private/loopback (${internalHost})`);
  }

  // 1. Health
  try {
    const health = await request("/health");
    if (health.ok && health.json?.status === "ok") {
      ok("Sub2API /health reports ok");
    } else {
      failed(`Sub2API /health failed (HTTP ${health.status}: ${health.text.slice(0, 120)})`);
    }
  } catch (error) {
    failed(error instanceof Error ? error.message : "health check failed");
    return;
  }

  // 2. Admin login + legal compliance gate (never auto-accepted)
  let token;
  try {
    token = await login();
    ok("admin login succeeded");
  } catch (error) {
    failed(error instanceof Error ? error.message : "admin login failed");
    return;
  }

  try {
    const acknowledged = await ensureCompliance(token);
    if (!acknowledged) return;
  } catch (error) {
    failed(error instanceof Error ? error.message : "compliance check failed");
    return;
  }

  // 3. Group exists, active, rate_multiplier = 1.0
  let group = null;
  try {
    group = unwrap(
      await request(`/api/v1/admin/groups/${groupId}`, { token }),
      "get group",
    );
    ok(`group ${groupId} exists (${group?.name || "unnamed"}, platform ${group?.platform || "?"})`);
    if (group?.status !== "active") {
      failed(`group ${groupId} status is ${group?.status || "unknown"}; expected active`);
    } else {
      ok(`group ${groupId} is active`);
    }
    if (isOne(group?.rate_multiplier)) {
      ok(`group ${groupId} rate_multiplier is 1.0`);
    } else {
      failed(
        `group ${groupId} rate_multiplier is ${group?.rate_multiplier}; expected 1.0`,
      );
    }
  } catch (error) {
    failed(error instanceof Error ? error.message : "group check failed");
  }

  // 4. Model pricing + allowlist
  if (group) {
    const pricing = Array.isArray(group.model_pricing) ? group.model_pricing : [];
    const pricedModels = new Set();
    const pricingProblems = [];

    if (pricing.length === 0) {
      failed("group model_pricing is empty; run npm run pricing:sync (or scripts/pricing-sync.mjs --force)");
    }

    for (const [index, entry] of pricing.entries()) {
      const models = Array.isArray(entry?.models) ? entry.models : [];
      if (models.length === 0) pricingProblems.push(`entry ${index} has no models`);
      for (const model of models) pricedModels.add(model);

      const mode = entry?.billing_mode || "token";
      if (mode === "token") {
        if (!money(entry?.input_price) || !money(entry?.output_price)) {
          pricingProblems.push(`entry ${index} has invalid token prices`);
        } else if ((entry.input_price || 0) === 0 && (entry.output_price || 0) === 0) {
          pricingProblems.push(`entry ${index} has zero token prices`);
        }
      } else if (mode === "per_request") {
        if (!money(entry?.per_request_price) || entry.per_request_price <= 0) {
          pricingProblems.push(`entry ${index} has an invalid per_request_price`);
        }
      } else {
        pricingProblems.push(`entry ${index} uses unsupported billing_mode ${mode}`);
      }
      if (entry?.cache_read_price != null && !money(entry.cache_read_price)) {
        pricingProblems.push(`entry ${index} has an invalid cache_read_price`);
      }
      if (entry?.cache_write_price != null && !money(entry.cache_write_price)) {
        pricingProblems.push(`entry ${index} has an invalid cache_write_price`);
      }
    }

    if (pricing.length > 0) {
      if (pricingProblems.length === 0) {
        ok(`model pricing present for ${pricedModels.size} model(s) in ${pricing.length} entries`);
      } else {
        failed(`model pricing problems: ${pricingProblems.slice(0, 8).join("; ")}`);
      }
    }

    const allowlist = group.model_allowlist;
    const allowlistModels = Array.isArray(allowlist?.models) ? allowlist.models : [];
    if (allowlist?.enabled !== true) {
      warn(
        "group model allowlist is disabled; pricing sync normally enables it so only published models are served",
      );
    } else if (allowlistModels.length === 0) {
      failed("group model allowlist is enabled but empty");
    } else {
      const missing = allowlistModels.filter((model) => !pricedModels.has(model));
      if (missing.length > 0) {
        failed(
          `allowlist models without group pricing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ""}`,
        );
      } else {
        ok(`model allowlist covers ${allowlistModels.length} priced model(s)`);
      }
    }
  }

  // 5. Every account in the group must bill at 1.0
  try {
    const accounts = await listGroupAccounts(token);
    if (accounts.length === 0) {
      failed(`no accounts are assigned to group ${groupId}; Sub2API cannot serve traffic`);
    } else {
      const bad = accounts.filter((account) => !isOne(account?.rate_multiplier));
      if (bad.length > 0) {
        failed(
          `accounts with rate_multiplier != 1.0: ${bad
            .slice(0, 10)
            .map((account) => `#${account.id} ${account.name || ""}=${account.rate_multiplier}`)
            .join(", ")}${bad.length > 10 ? ` (+${bad.length - 10} more)` : ""}`,
        );
      } else {
        ok(`all ${accounts.length} account(s) in group ${groupId} use rate_multiplier 1.0`);
      }
      const schedulable = accounts.filter((account) => account?.schedulable === true).length;
      if (schedulable === 0) {
        warn("no account in the group is currently schedulable; check account status/quota");
      }
    }
  } catch (error) {
    failed(error instanceof Error ? error.message : "account check failed");
  }

  // 6. Model plaza (public pricing showcase)
  try {
    const settings = unwrap(
      await request("/api/v1/admin/settings", { token }),
      "get settings",
    );
    if (settings?.model_plaza_enabled === true) {
      ok("model plaza is enabled");
    } else {
      warn("model plaza is disabled; enable it in Sub2API admin settings to publish model pricing");
    }
  } catch (error) {
    warn(error instanceof Error ? error.message : "could not read model plaza setting");
  }

  // 7. No public exposure of Sub2API admin routes
  await checkPublicExposure();
}

try {
  await main();
} catch (error) {
  failed(error instanceof Error ? error.message : "unexpected verification error");
}

console.log("");
if (warnings.length > 0) {
  console.log(`${warnings.length} warning(s):`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("All Sub2API configuration checks passed.");
