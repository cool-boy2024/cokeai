import { query, toNumber } from "@/lib/db";

/**
 * 评测结果的读取层。写入只发生在 scripts/eval/run-eval.ts（运维脚本），
 * 后台页面只读，避免误操作污染对比数据。
 */

export type EvalBatch = {
  batchId: string;
  createdAt: string;
  fixtures: number;
  variants: string[];
};

export type EvalVariantRow = {
  variant: string;
  runs: number;
  errors: number;
  schemaValidPct: number;
  leakFreePct: number;
  usablePct: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgLatencyMs: number;
  avgHumanScore: number | null;
  ratedRuns: number;
};

export type EvalFailureRow = {
  fixtureId: string;
  variant: string;
  error: string | null;
  leakSamples: string[];
  priceMentions: number;
  lengthIssues: string[];
  schemaErrors: number;
};

/** 最近一次评测批次；没有跑过评测时返回 null。 */
export async function loadLatestEvalBatch(): Promise<EvalBatch | null> {
  const result = await query<{
    batch_id: string;
    created_at: string;
    fixtures: string;
    variants: string[];
  }>(
    `SELECT batch_id::text, MIN(created_at) AS created_at,
            COUNT(DISTINCT fixture_id)::text AS fixtures,
            array_agg(DISTINCT variant) AS variants
       FROM ai_eval_runs
      GROUP BY batch_id
      ORDER BY MIN(created_at) DESC
      LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    batchId: row.batch_id,
    createdAt: new Date(row.created_at).toISOString(),
    fixtures: Number(row.fixtures),
    variants: row.variants,
  };
}

type MetricsJson = {
  schemaValid?: boolean;
  leakCount?: number;
  leakSamples?: string[];
  priceMentions?: number;
  fieldsFilled?: boolean;
  lengthIssues?: string[];
  noticeLifted?: boolean;
  includesEnough?: boolean;
  usable?: boolean;
  schemaErrors?: number;
};

export async function loadEvalVariantSummary(batchId: string): Promise<EvalVariantRow[]> {
  const result = await query<{
    variant: string;
    runs: string;
    errors: string;
    schema_ok: string;
    leak_free: string;
    usable: string;
    avg_input: string;
    avg_output: string;
    avg_latency: string;
    avg_human: string | null;
    rated: string;
  }>(
    `SELECT variant,
            COUNT(*) FILTER (WHERE error IS NULL) AS runs,
            COUNT(*) FILTER (WHERE error IS NOT NULL) AS errors,
            COUNT(*) FILTER (WHERE error IS NULL AND (metrics->>'schemaValid')::boolean) AS schema_ok,
            COUNT(*) FILTER (WHERE error IS NULL AND COALESCE((metrics->>'leakCount')::int, 0) = 0) AS leak_free,
            COUNT(*) FILTER (WHERE error IS NULL AND (metrics->>'usable')::boolean) AS usable,
            COALESCE(AVG(input_tokens) FILTER (WHERE error IS NULL), 0) AS avg_input,
            COALESCE(AVG(output_tokens) FILTER (WHERE error IS NULL), 0) AS avg_output,
            COALESCE(AVG(latency_ms) FILTER (WHERE error IS NULL), 0) AS avg_latency,
            AVG(human_score) AS avg_human,
            COUNT(human_score) AS rated
       FROM ai_eval_runs
      WHERE batch_id = $1
      GROUP BY variant`,
    [batchId],
  );

  const pct = (value: number, total: number) => (total === 0 ? 0 : (value / total) * 100);
  return result.rows
    .map((row) => {
      const runs = Number(row.runs);
      return {
        variant: row.variant,
        runs,
        errors: Number(row.errors),
        schemaValidPct: pct(Number(row.schema_ok), runs),
        leakFreePct: pct(Number(row.leak_free), runs),
        usablePct: pct(Number(row.usable), runs),
        avgInputTokens: Math.round(toNumber(row.avg_input)),
        avgOutputTokens: Math.round(toNumber(row.avg_output)),
        avgLatencyMs: Math.round(toNumber(row.avg_latency)),
        avgHumanScore: row.avg_human === null ? null : Number(Number(row.avg_human).toFixed(2)),
        ratedRuns: Number(row.rated),
      };
    })
    .sort((a, b) => {
      const order = ["heuristic", "single_shot", "agent"];
      return order.indexOf(a.variant) - order.indexOf(b.variant);
    });
}

/** 不可用样本的具体原因，运营看到能直接定位问题类型。 */
export async function loadEvalFailures(
  batchId: string,
  limit = 15,
): Promise<EvalFailureRow[]> {
  const result = await query<{
    fixture_id: string;
    variant: string;
    error: string | null;
    metrics: MetricsJson;
  }>(
    `SELECT fixture_id, variant, error, metrics
       FROM ai_eval_runs
      WHERE batch_id = $1
        AND (error IS NOT NULL OR NOT ((metrics->>'usable')::boolean))
      ORDER BY variant, fixture_id
      LIMIT $2`,
    [batchId, limit],
  );
  return result.rows.map((row) => ({
    fixtureId: row.fixture_id,
    variant: row.variant,
    error: row.error,
    leakSamples: row.metrics?.leakSamples || [],
    priceMentions: row.metrics?.priceMentions || 0,
    lengthIssues: row.metrics?.lengthIssues || [],
    schemaErrors: row.metrics?.schemaErrors || 0,
  }));
}

export type EvalDraftSample = {
  fixtureId: string;
  variant: string;
  draft: {
    name?: string;
    subtitle?: string;
    description?: string;
    includes?: string[];
    usage?: string[];
  } | null;
  humanScore: number | null;
  error: string | null;
};

/** 抽样几份草稿给人工打分用（同一样本三个方案并排）。 */
export async function loadEvalDraftSamples(
  batchId: string,
  limit = 6,
): Promise<EvalDraftSample[]> {
  const result = await query<{
    fixture_id: string;
    variant: string;
    draft: EvalDraftSample["draft"];
    human_score: number | null;
    error: string | null;
  }>(
    `WITH picked AS (
       SELECT DISTINCT fixture_id FROM ai_eval_runs
        WHERE batch_id = $1 AND error IS NULL
        ORDER BY fixture_id
        LIMIT $2
     )
     SELECT r.fixture_id, r.variant, r.draft, r.human_score, r.error
       FROM ai_eval_runs r
       JOIN picked p ON p.fixture_id = r.fixture_id
      WHERE r.batch_id = $1
      ORDER BY r.fixture_id, r.variant`,
    [batchId, limit],
  );
  return result.rows.map((row) => ({
    fixtureId: row.fixture_id,
    variant: row.variant,
    draft: row.draft,
    humanScore: row.human_score,
    error: row.error,
  }));
}
