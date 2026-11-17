/**
 * 三方案对照评测：同一批样本分别跑 heuristic / single_shot / agent，算自动
 * 指标，写入 ai_eval_runs，并打印横向对比表。可选导出 Markdown 报告。
 *
 * 样本来自 .local-data/eval/fixtures.json（由 build-fixtures.ts 生成，仓库外）。
 *
 * 用法：
 *   npx tsx scripts/eval/run-eval.ts                      # 三个方案全跑
 *   npx tsx scripts/eval/run-eval.ts --variants heuristic # 只跑规则版（无需网关）
 *   npx tsx scripts/eval/run-eval.ts --dry-run            # 只打印，不写库
 *   npx tsx scripts/eval/run-eval.ts --limit 10           # 只跑前 10 条样本
 *   npx tsx scripts/eval/run-eval.ts --report out.md      # 同时导出 Markdown
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../env.mjs";
import { query } from "@/lib/db";
import { config } from "@/lib/config";
import { RUNNERS, type Runner } from "./runners";
import {
  scoreDraft,
  summarize,
  type EvalFixture,
  type EvalMetrics,
  type VariantSummary,
} from "./metrics";

loadEnv();

const FIXTURES_PATH = ".local-data/eval/fixtures.json";

type RunRow = {
  fixtureId: string;
  variant: string;
  metrics: EvalMetrics;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  modelCalls: number;
  toolCalls: number;
  error: string | null;
  draft: unknown;
};

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function loadFixtures(limit: number | null): EvalFixture[] {
  // 生产上样本不进镜像，用 --fixtures 指定容器内的临时路径。
  const path = argValue("--fixtures") || FIXTURES_PATH;
  if (!existsSync(path)) {
    throw new Error(
      `缺少评测样本 ${path}。先在本地运行 npx tsx scripts/eval/build-fixtures.ts 生成，` +
        `再把它复制到目标环境（样本含货源正文，绝不能提交到仓库）。`,
    );
  }
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    fixtures?: EvalFixture[];
  };
  const fixtures = payload.fixtures || [];
  if (!fixtures.length) throw new Error(`${path} 里没有样本。`);
  return limit ? fixtures.slice(0, limit) : fixtures;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function table(rows: VariantSummary[]): string {
  const header = [
    "方案",
    "样本",
    "错误",
    "Zod 通过",
    "零泄露",
    "可用",
    "输入 tok",
    "输出 tok",
    "耗时",
    "人工分",
  ];
  const body = rows.map((row) => [
    row.variant,
    String(row.runs),
    String(row.errors),
    pct(row.schemaValidPct),
    pct(row.leakFreePct),
    pct(row.usablePct),
    String(row.avgInputTokens),
    String(row.avgOutputTokens),
    `${row.avgLatencyMs}ms`,
    row.avgHumanScore === null ? "—" : String(row.avgHumanScore),
  ]);
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...body.map((line) => line[index].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...body.map(line)].join(
    "\n",
  );
}

/** 找出每个方案里失败的具体原因，方便立刻定位问题。 */
function failureDigest(rows: RunRow[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.error) {
      lines.push(`  ${row.variant} · ${row.fixtureId}: 运行失败 — ${row.error}`);
      continue;
    }
    if (!row.metrics.schemaValid) {
      lines.push(`  ${row.variant} · ${row.fixtureId}: Zod 不通过（${row.metrics.schemaErrors} 项）`);
    }
    if (row.metrics.leakCount > 0) {
      lines.push(
        `  ${row.variant} · ${row.fixtureId}: 泄露 ${row.metrics.leakSamples.join("/")}`,
      );
    }
    if (row.metrics.priceMentions > 0) {
      lines.push(`  ${row.variant} · ${row.fixtureId}: 出现价格 ${row.metrics.priceMentions} 处`);
    }
    if (row.metrics.lengthIssues.length) {
      lines.push(
        `  ${row.variant} · ${row.fixtureId}: ${row.metrics.lengthIssues.join("；")}`,
      );
    }
  }
  return lines;
}

function toMarkdown(rows: VariantSummary[], batchId: string, fixtureCount: number): string {
  const lines = [
    "# AI 商品上架三方案评测",
    "",
    `- 批次：\`${batchId}\``,
    `- 样本数：${fixtureCount}`,
    `- 时间：${new Date().toISOString()}`,
    "",
    "| 方案 | 样本 | 错误 | Zod 通过 | 零泄露 | 可用 | 平均输入 tok | 平均输出 tok | 平均耗时 | 人工分 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.variant} | ${row.runs} | ${row.errors} | ${pct(row.schemaValidPct)} | ${pct(
        row.leakFreePct,
      )} | ${pct(row.usablePct)} | ${row.avgInputTokens} | ${row.avgOutputTokens} | ${
        row.avgLatencyMs
      }ms | ${row.avgHumanScore ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("> 「可用」= Zod 通过 ∧ 零泄露 ∧ 无价格外露 ∧ 字段齐全 ∧ 长度合规 ∧ 规则抬到原文。");
  return lines.join("\n");
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const limit = Number(argValue("--limit") || 0) || null;
  const reportPath = argValue("--report");
  const requested = (argValue("--variants") || "heuristic,single_shot,agent")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const unknown = requested.filter((variant) => !RUNNERS[variant]);
  if (unknown.length) {
    throw new Error(`未知方案：${unknown.join(", ")}（可用：${Object.keys(RUNNERS).join(", ")}）`);
  }

  const fixtures = loadFixtures(limit);
  const batchId = randomUUID();
  const rows: RunRow[] = [];

  console.log(`批次 ${batchId} · 样本 ${fixtures.length} 条 · 方案 ${requested.join(" / ")}`);
  console.log(`模型：${config.shopImportAgentModel}\n`);

  for (const variant of requested) {
    const runner: Runner = RUNNERS[variant];
    console.log(`▶ ${variant}`);
    for (const [index, fixture] of fixtures.entries()) {
      const result = await runner(fixture);
      // 规则版能跑通即视为成功；模型方案失败时 metrics 全 false。
      const metrics = result.draft
        ? scoreDraft(result.draft, fixture)
        : scoreDraft({}, fixture);
      rows.push({
        fixtureId: fixture.id,
        variant,
        metrics,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        modelCalls: result.modelCalls,
        toolCalls: result.toolCalls,
        error: result.error,
        draft: result.draft,
      });
      const mark = result.error ? "✗" : metrics.usable ? "✓" : "·";
      process.stdout.write(
        `${mark}${(index + 1) % 10 === 0 ? ` ${index + 1}/${fixtures.length}\n` : ""}`,
      );
    }
    console.log(`\n`);
  }

  const summary = summarize(rows);
  console.log("=== 横向对比 ===");
  console.log(table(summary));

  const digest = failureDigest(rows);
  if (digest.length) {
    console.log("\n=== 失败明细（前 20 条）===");
    console.log(digest.slice(0, 20).join("\n"));
    if (digest.length > 20) console.log(`  …… 另有 ${digest.length - 20} 条`);
  }

  if (!dryRun) {
    for (const row of rows) {
      await query(
        `INSERT INTO ai_eval_runs
           (batch_id, fixture_id, variant, model_id, draft, metrics,
            input_tokens, output_tokens, latency_ms, model_calls, tool_calls, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (batch_id, fixture_id, variant) DO NOTHING`,
        [
          batchId,
          row.fixtureId,
          row.variant,
          row.error ? null : config.shopImportAgentModel,
          row.draft ? JSON.stringify(row.draft) : null,
          JSON.stringify(row.metrics),
          row.inputTokens,
          row.outputTokens,
          row.latencyMs,
          row.modelCalls,
          row.toolCalls,
          row.error ? row.error.slice(0, 500) : null,
        ],
      );
    }
    console.log(`\n已写入 ai_eval_runs（批次 ${batchId}）。`);
  } else {
    console.log("\n--dry-run：未写库。");
  }

  if (reportPath) {
    writeFileSync(reportPath, toMarkdown(summary, batchId, fixtures.length));
    console.log(`报告已写入 ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
