import { query } from "./db";

/**
 * API 用量指标。数据源是本地 usage_events 表：Next.js 回滚网关的 /v1 调用、
 * 以及内部 LLM 任务（小店 AI 上架 Agent 等）。公网 /v1 流量由 Sub2API 计量，
 * 不在这里——两套口径在页面上分开说明，绝不混算成功率。
 *
 * 所有时间桶按 Asia/Shanghai 切（和经营看板同一口径），运营看到的一天就是
 * 自然日，不用心算时区差。
 */

export const METRICS_TIMEZONE = "Asia/Shanghai";

export type MetricsRange = 1 | 7 | 30;

export const METRICS_RANGES: Array<{ value: MetricsRange; label: string }> = [
  { value: 1, label: "近 24 小时" },
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
];

export function parseMetricsRange(raw: string | undefined): MetricsRange {
  return raw === "1" ? 1 : raw === "30" ? 30 : 7;
}

export type UsageOverview = {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  successRatePct: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  chargedMicros: number;
  upstreamCostMicros: number;
  internalRequests: number;
  internalUpstreamCostMicros: number;
};

export type TrendPoint = {
  /** 桶起点的本地时间标签，格式 MM-DD HH（小时桶）或 MM-DD（天桶）。 */
  label: string;
  total: number;
  succeeded: number;
  failed: number;
  p95Ms: number | null;
};

export type MinutePoint = {
  label: string;
  requests: number;
  tokens: number;
};

export type ModelSlice = {
  modelId: string;
  requests: number;
  succeeded: number;
  inputTokens: number;
  outputTokens: number;
  upstreamCostMicros: number;
  p95Ms: number | null;
};

export type ErrorSlice = {
  code: string;
  count: number;
};

export type LatencyHistogram = {
  /** 与 LATENCY_BUCKET_EDGES 一一对应的各桶计数。 */
  counts: number[];
};

/** 延迟直方图分桶边界（毫秒），标签在 labels() 里生成。 */
export const LATENCY_BUCKET_EDGES = [0, 1_000, 3_000, 10_000, 30_000, Infinity] as const;

export function latencyBucketLabels(): string[] {
  const fmt = (ms: number) => (ms >= 1_000 ? `${ms / 1_000}`.replace(/\.0$/, "") : `${ms}`);
  const labels: string[] = [];
  for (let i = 0; i < LATENCY_BUCKET_EDGES.length - 1; i++) {
    const from = LATENCY_BUCKET_EDGES[i];
    const to = LATENCY_BUCKET_EDGES[i + 1];
    labels.push(to === Infinity ? `≥${fmt(from)}s` : `${fmt(from)}–${fmt(to)}s`);
  }
  return labels;
}

export function successRatePct(succeeded: number, failed: number): number | null {
  const finished = succeeded + failed;
  if (finished <= 0) return null;
  return (succeeded / finished) * 100;
}

export type UsageMetrics = {
  generatedAt: string;
  range: MetricsRange;
  overview: UsageOverview;
  trend: TrendPoint[];
  minutes: MinutePoint[];
  models: ModelSlice[];
  errors: ErrorSlice[];
  latency: LatencyHistogram;
};

function rangeStart(range: MetricsRange): string {
  // 多给一天余量：天桶按本地自然日截断，30 天视图需要覆盖 31 个本地日边界。
  return `now() - interval '${range + 1} days'`;
}

async function loadOverview(range: MetricsRange): Promise<UsageOverview> {
  const result = await query<{
    total: string;
    succeeded: string;
    failed: string;
    pending: string;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    input_tokens: string;
    output_tokens: string;
    cache_read_tokens: string;
    cache_write_tokens: string;
    charged_micros: string;
    upstream_cost_micros: string;
    internal_requests: string;
    internal_cost: string;
  }>(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(charged_micros), 0) AS charged_micros,
      COALESCE(SUM(upstream_cost_micros), 0) AS upstream_cost_micros,
      COUNT(*) FILTER (WHERE internal) AS internal_requests,
      COALESCE(SUM(upstream_cost_micros) FILTER (WHERE internal), 0) AS internal_cost
     FROM usage_events
     WHERE created_at >= now() - interval '${range} days'`,
  );
  const row = result.rows[0];
  return {
    total: Number(row.total),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    pending: Number(row.pending),
    successRatePct: successRatePct(Number(row.succeeded), Number(row.failed)),
    p50Ms: row.p50 === null ? null : Math.round(Number(row.p50)),
    p95Ms: row.p95 === null ? null : Math.round(Number(row.p95)),
    p99Ms: row.p99 === null ? null : Math.round(Number(row.p99)),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheWriteTokens: Number(row.cache_write_tokens),
    chargedMicros: Number(row.charged_micros),
    upstreamCostMicros: Number(row.upstream_cost_micros),
    internalRequests: Number(row.internal_requests),
    internalUpstreamCostMicros: Number(row.internal_cost),
  };
}

/** 生成零填充的本地时间桶，LEFT JOIN 用量行，保证空桶也在图上占位。 */
function trendQuery(range: MetricsRange): string {
  const hours = range === 1;
  const count = hours ? 23 : range - 1;
  const unit = hours ? "hour" : "day";
  const coarse = rangeStart(range);
  return `
    WITH buckets AS (
      SELECT generate_series(
        date_trunc('${unit}', (now() AT TIME ZONE '${METRICS_TIMEZONE}')) - interval '${count} ${unit}s',
        date_trunc('${unit}', (now() AT TIME ZONE '${METRICS_TIMEZONE}')),
        interval '1 ${unit}'
      ) AS bucket
    )
    SELECT
      to_char(b.bucket, '${hours ? "MM-DD HH24:00" : "MM-DD"}') AS label,
      COUNT(u.id) AS total,
      COUNT(u.id) FILTER (WHERE u.status = 'succeeded') AS succeeded,
      COUNT(u.id) FILTER (WHERE u.status = 'failed') AS failed,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY u.latency_ms) AS p95
     FROM buckets b
     LEFT JOIN usage_events u
       ON (u.created_at AT TIME ZONE '${METRICS_TIMEZONE}') >= b.bucket
      AND (u.created_at AT TIME ZONE '${METRICS_TIMEZONE}') < b.bucket + interval '1 ${unit}'
      AND u.created_at >= ${coarse}
     GROUP BY b.bucket
     ORDER BY b.bucket`;
}

async function loadTrend(range: MetricsRange): Promise<TrendPoint[]> {
  const result = await query<{
    label: string;
    total: string;
    succeeded: string;
    failed: string;
    p95: string | null;
  }>(trendQuery(range));
  return result.rows.map((row) => ({
    label: row.label,
    total: Number(row.total),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    p95Ms: row.p95 === null ? null : Math.round(Number(row.p95)),
  }));
}

async function loadMinutes(): Promise<MinutePoint[]> {
  const result = await query<{
    label: string;
    requests: string;
    tokens: string;
  }>(
    `WITH buckets AS (
      SELECT generate_series(
        date_trunc('minute', now()) - interval '59 minutes',
        date_trunc('minute', now()),
        interval '1 minute'
      ) AS bucket
    )
    SELECT
      to_char(b.bucket, 'HH24:MI') AS label,
      COUNT(u.id) AS requests,
      COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS tokens
     FROM buckets b
     LEFT JOIN usage_events u
       ON date_trunc('minute', u.created_at) = b.bucket
      AND u.created_at >= now() - interval '1 hour'
     GROUP BY b.bucket
     ORDER BY b.bucket`,
  );
  return result.rows.map((row) => ({
    label: row.label,
    requests: Number(row.requests),
    tokens: Number(row.tokens),
  }));
}

async function loadModels(range: MetricsRange): Promise<ModelSlice[]> {
  const result = await query<{
    model_id: string;
    requests: string;
    succeeded: string;
    input_tokens: string;
    output_tokens: string;
    upstream_cost_micros: string;
    p95: string | null;
  }>(
    `SELECT
      model_id,
      COUNT(*) AS requests,
      COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(upstream_cost_micros), 0) AS upstream_cost_micros,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
     FROM usage_events
     WHERE created_at >= now() - interval '${range} days'
     GROUP BY model_id
     ORDER BY requests DESC
     LIMIT 12`,
  );
  return result.rows.map((row) => ({
    modelId: row.model_id,
    requests: Number(row.requests),
    succeeded: Number(row.succeeded),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    upstreamCostMicros: Number(row.upstream_cost_micros),
    p95Ms: row.p95 === null ? null : Math.round(Number(row.p95)),
  }));
}

async function loadErrors(range: MetricsRange): Promise<ErrorSlice[]> {
  const result = await query<{ code: string; count: string }>(
    `SELECT COALESCE(error_code, 'unknown') AS code, COUNT(*) AS count
     FROM usage_events
     WHERE created_at >= now() - interval '${range} days'
       AND status = 'failed'
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 8`,
  );
  return result.rows.map((row) => ({ code: row.code, count: Number(row.count) }));
}

async function loadLatencyHistogram(range: MetricsRange): Promise<LatencyHistogram> {
  const result = await query<{
    b0: string;
    b1: string;
    b2: string;
    b3: string;
    b4: string;
  }>(
    `SELECT
      COUNT(*) FILTER (WHERE latency_ms >= 0 AND latency_ms < 1000) AS b0,
      COUNT(*) FILTER (WHERE latency_ms >= 1000 AND latency_ms < 3000) AS b1,
      COUNT(*) FILTER (WHERE latency_ms >= 3000 AND latency_ms < 10000) AS b2,
      COUNT(*) FILTER (WHERE latency_ms >= 10000 AND latency_ms < 30000) AS b3,
      COUNT(*) FILTER (WHERE latency_ms >= 30000) AS b4
     FROM usage_events
     WHERE created_at >= now() - interval '${range} days'
       AND latency_ms IS NOT NULL`,
  );
  const row = result.rows[0];
  return {
    counts: [row.b0, row.b1, row.b2, row.b3, row.b4].map((value) => Number(value)),
  };
}

export async function loadUsageMetrics(range: MetricsRange): Promise<UsageMetrics> {
  const [overview, trend, minutes, models, errors, latency] = await Promise.all([
    loadOverview(range),
    loadTrend(range),
    loadMinutes(),
    loadModels(range),
    loadErrors(range),
    loadLatencyHistogram(range),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    range,
    overview,
    trend,
    minutes,
    models,
    errors,
    latency,
  };
}
