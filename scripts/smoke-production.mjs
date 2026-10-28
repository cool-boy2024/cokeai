#!/usr/bin/env node
/**
 * Production smoke test for the CokeAI edge + gateway.
 *
 * Usage:
 *   node scripts/smoke-production.mjs
 *
 * Environment:
 *   APP_URL                 public origin, e.g. https://cokeai.cc.cd
 *   SMOKE_API_KEY           a funded test key (sk-coke-...)
 *   SMOKE_REVOKED_API_KEY   optional second key that was deliberately revoked
 *   SMOKE_MODEL             optional model id; defaults to the first /v1/models id
 *
 * Checks:
 *   - /api/health stays on the Next.js app
 *   - /v1/models without a key is JSON 401 (not an HTML page)
 *   - /v1/models with the test key lists models
 *   - non-stream and stream chat completions work
 *   - SSE is not compressed and the first bytes arrive promptly
 *   - a revoked (or unknown) key gets 401
 *   - /api/v1/admin/* is not reachable on the public origin
 *
 * Secrets are never printed.
 */

import crypto from "node:crypto";
import { loadEnv } from "./env.mjs";

loadEnv();

const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
const apiKey = process.env.SMOKE_API_KEY || "";
const revokedKey = process.env.SMOKE_REVOKED_API_KEY || "";
const modelOverride = (process.env.SMOKE_MODEL || "").trim();
const timeoutMs = 30_000;
const streamFirstByteTimeoutMs = 15_000;
const streamTotalTimeoutMs = 90_000;

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

async function send(path, options = {}) {
  const { method = "GET", headers = {}, body, timeout = timeoutMs } = options;
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${appUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new Error(`cannot reach ${appUrl}${path}: ${error instanceof Error ? error.message : "network error"}`);
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

async function expectJson401(path, headers, label) {
  const response = await send(path, { headers });
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (response.status !== 401) {
    failed(`${label}: expected HTTP 401, got ${response.status}`);
    return;
  }
  if (!contentType.includes("application/json")) {
    failed(`${label}: expected a JSON 401, got Content-Type ${contentType || "(none)"} (HTML?)`);
    return;
  }
  if (!response.json || typeof response.json !== "object") {
    failed(`${label}: 401 body is not valid JSON`);
    return;
  }
  ok(`${label}: JSON 401`);
}

async function checkHealth() {
  try {
    const response = await send("/api/health");
    if (response.status !== 200) {
      failed(`/api/health returned ${response.status}`);
      return;
    }
    if (response.json?.status !== "ok") {
      failed(`/api/health did not report status=ok: ${response.text.slice(0, 120)}`);
      return;
    }
    ok("/api/health is healthy");
  } catch (error) {
    failed(error instanceof Error ? error.message : "/api/health failed");
  }
}

async function checkPublicAdminExposure() {
  const paths = ["/api/v1/admin/users", "/api/v1/admin/settings", "/api/v1/admin/compliance"];
  for (const path of paths) {
    let response;
    try {
      response = await fetch(`${appUrl}${path}`, {
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "text/html,application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      failed(`could not probe ${path}: ${error instanceof Error ? error.message : "network error"}`);
      continue;
    }
    const mitigated = response.headers.get("cf-mitigated") || "";
    const contentType = response.headers.get("content-type") || "";
    if (mitigated === "challenge") {
      warn(`public probe ${path} was challenged by Cloudflare; API paths need a WAF bypass`);
      continue;
    }
    if (response.status === 200 || response.status === 401 || response.status === 403) {
      failed(
        `${path} responded HTTP ${response.status} on the public origin (${contentType || "no content-type"}); admin routes must not be publicly routable`,
      );
    } else {
      ok(`${path} is not publicly routable (HTTP ${response.status})`);
    }
  }
}

async function listModels() {
  const response = await send("/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.status !== 200) {
    failed(`/v1/models with test key returned ${response.status}: ${response.text.slice(0, 160)}`);
    return null;
  }
  const models = Array.isArray(response.json?.data)
    ? response.json.data
    : Array.isArray(response.json)
      ? response.json
      : [];
  if (models.length === 0) {
    failed("/v1/models returned an empty model list");
    return null;
  }
  ok(`/v1/models lists ${models.length} model(s)`);
  return models;
}

async function checkNonStream(model) {
  const response = await send("/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      max_tokens: 64,
      stream: false,
    },
    timeout: 60_000,
  });
  if (response.status !== 200) {
    failed(`non-stream chat returned ${response.status}: ${response.text.slice(0, 200)}`);
    return;
  }
  if (!Array.isArray(response.json?.choices) || response.json.choices.length === 0) {
    failed("non-stream chat response has no choices");
    return;
  }
  ok(`non-stream chat succeeded with ${model}`);
}

async function checkStream(model) {
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), streamTotalTimeoutMs);
  let firstByteTimer;
  let reader;
  try {
    const response = await fetch(`${appUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Count from 1 to 3." }],
        max_tokens: 64,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (response.status !== 200) {
      const text = await response.text();
      failed(`stream chat returned ${response.status}: ${text.slice(0, 200)}`);
      return;
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/event-stream")) {
      failed(`stream chat Content-Type is ${contentType || "(none)"}, expected text/event-stream`);
      return;
    }
    const encoding = (response.headers.get("content-encoding") || "").toLowerCase();
    if (encoding && encoding !== "identity") {
      failed(`stream chat is compressed (Content-Encoding: ${encoding}); the edge must exclude text/event-stream`);
      return;
    }
    if (!response.body) {
      failed("stream chat response has no body");
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const startedAt = Date.now();

    const first = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        firstByteTimer = setTimeout(
          () => reject(new Error(`no SSE bytes within ${streamFirstByteTimeoutMs / 1000}s (possible proxy buffering)`)),
          streamFirstByteTimeoutMs,
        );
      }),
    ]);
    if (first.done) {
      failed("stream chat ended before sending any data");
      return;
    }
    const firstByteMs = Date.now() - startedAt;
    text += decoder.decode(first.value, { stream: true });

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 2_000_000) break;
    }
    text += decoder.decode();

    if (!text.includes("data:")) {
      failed("stream response contains no SSE data frames");
      return;
    }
    if (!text.includes("choices")) {
      failed("stream response contains no choices payload");
      return;
    }
    if (!text.includes("[DONE]")) {
      warn("stream completed without a [DONE] sentinel; confirm upstream/proxy compatibility");
    }
    ok(`stream chat succeeded with ${model} (first byte ${firstByteMs} ms, uncompressed)`);
  } catch (error) {
    failed(error instanceof Error ? error.message : "stream chat failed");
  } finally {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    clearTimeout(totalTimer);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Already closed or aborted.
      }
    }
  }
}

async function checkRevocation() {
  if (revokedKey) {
    await expectJson401(
      "/v1/models",
      { Authorization: `Bearer ${revokedKey}` },
      "revoked key",
    );
    return;
  }

  const unknownKey = `sk-coke-smoke-${crypto.randomBytes(24).toString("hex")}`;
  await expectJson401(
    "/v1/models",
    { Authorization: `Bearer ${unknownKey}` },
    "unknown key",
  );
  warn(
    "SMOKE_REVOKED_API_KEY is unset; checked an unknown key instead of a real revoked key. Create and revoke a throwaway key to cover that path.",
  );
}

function maskKey(value) {
  if (!value) return "(unset)";
  if (value.length <= 12) return "(set)";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

async function main() {
  if (!appUrl) {
    console.error("APP_URL is required (for example https://cokeai.cc.cd).");
    process.exit(2);
  }
  if (!apiKey) {
    console.error("SMOKE_API_KEY is required (a funded test key).");
    process.exit(2);
  }

  console.log(`Smoke target: ${appUrl}`);
  console.log(`Test key: ${maskKey(apiKey)}`);
  console.log("");

  await checkHealth();
  await expectJson401("/v1/models", {}, "missing key");
  await checkPublicAdminExposure();

  const models = await listModels();
  if (models) {
    const model =
      modelOverride ||
      models.map((item) => item?.id).find((id) => typeof id === "string" && id.length > 0);
    if (!model) {
      failed("could not determine a model id for chat tests (set SMOKE_MODEL)");
    } else {
      if (modelOverride && !models.some((item) => item?.id === modelOverride)) {
        warn(`SMOKE_MODEL ${modelOverride} is not present in /v1/models; using it anyway`);
      }
      await checkNonStream(model);
      await checkStream(model);
    }
  }

  await checkRevocation();
}

try {
  await main();
} catch (error) {
  failed(error instanceof Error ? error.message : "unexpected smoke-test error");
}

console.log("");
if (warnings.length > 0) {
  console.log(`${warnings.length} warning(s):`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log("All production smoke checks passed.");
