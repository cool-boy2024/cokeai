/**
 * Pure metrics tests. No database and no production data: exercises the
 * aggregation helpers from src/lib/metrics.ts and the cache-token parsing in
 * src/lib/gateway.ts. DB-shaped queries are validated by npm run db:migrate
 * plus the page itself against a local database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokensFromUsage } from "../src/lib/gateway";
import {
  LATENCY_BUCKET_EDGES,
  latencyBucketLabels,
  parseMetricsRange,
  successRatePct,
} from "../src/lib/metrics";

const here = dirname(fileURLToPath(import.meta.url));

function main() {
  // Success rate only counts finished events; a pending-heavy window must
  // not drag the ratio down.
  assert.equal(successRatePct(0, 0), null);
  assert.equal(successRatePct(5, 0), 100);
  assert.equal(successRatePct(90, 10), 90);
  assert.ok(Math.abs((successRatePct(1, 3) ?? 0) - 25) < 1e-9);

  // Range switch: anything unexpected falls back to 7 days.
  assert.equal(parseMetricsRange("1"), 1);
  assert.equal(parseMetricsRange("7"), 7);
  assert.equal(parseMetricsRange("30"), 30);
  assert.equal(parseMetricsRange(undefined), 7);
  assert.equal(parseMetricsRange("yes"), 7);
  assert.equal(parseMetricsRange("365"), 7);

  // Latency histogram: 6 edges define 5 buckets, labels match one-to-one.
  assert.equal(LATENCY_BUCKET_EDGES.length, 6);
  const labels = latencyBucketLabels();
  assert.equal(labels.length, LATENCY_BUCKET_EDGES.length - 1);
  assert.deepEqual(labels, ["0–1s", "1–3s", "3–10s", "10–30s", "≥30s"]);

  // OpenAI-style usage with cached tokens.
  const openai = tokensFromUsage({
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 60 },
    },
  });
  assert.ok(openai);
  assert.equal(openai.inputTokens, 100);
  assert.equal(openai.outputTokens, 50);
  assert.equal(openai.cacheReadTokens, 60);
  assert.equal(openai.cacheWriteTokens, 0);

  // Anthropic-style cache fields.
  const anthropic = tokensFromUsage({
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 8,
      cache_creation_input_tokens: 3,
    },
  });
  assert.ok(anthropic);
  assert.equal(anthropic.cacheReadTokens, 8);
  assert.equal(anthropic.cacheWriteTokens, 3);

  // Malformed / missing usage never throws; nonsense values clamp to 0.
  assert.equal(tokensFromUsage({}), null);
  assert.equal(tokensFromUsage({ usage: {} }), null);
  const negative = tokensFromUsage({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: -5 },
    },
  });
  assert.ok(negative);
  assert.equal(negative.cacheReadTokens, 0);

  // Schema must carry the idempotent columns the metrics page relies on.
  const schema = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");
  assert.ok(schema.includes("ADD COLUMN IF NOT EXISTS request_id UUID"));
  assert.ok(schema.includes("ADD COLUMN IF NOT EXISTS cache_read_tokens"));
  assert.ok(schema.includes("ADD COLUMN IF NOT EXISTS cache_write_tokens"));
  assert.ok(schema.includes("ADD COLUMN IF NOT EXISTS internal BOOLEAN"));
  assert.ok(schema.includes("CREATE INDEX IF NOT EXISTS usage_created_idx"));

  console.log("test-usage-metrics: all assertions passed");
}

main();
