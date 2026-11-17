import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { CostChart, QualityChart } from "@/components/admin-shop/EvalCharts";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  loadEvalDraftSamples,
  loadEvalFailures,
  loadEvalVariantSummary,
  loadLatestEvalBatch,
} from "@/lib/shop/eval";
import { EvalScoreForm } from "./score-form";

export const metadata: Metadata = {
  title: "上架评测",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const VARIANT_LABEL: Record<string, string> = {
  heuristic: "规则版",
  single_shot: "单轮模型",
  agent: "受控 Agent",
};

function variantLabel(variant: string): string {
  return VARIANT_LABEL[variant] || variant;
}

export default async function AdminShopEvalPage() {
  await requireAdmin();
  const batch = await loadLatestEvalBatch();

  if (!batch) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>上架评测</h1>
            <p>
              规则版 / 单轮模型 / 受控 Agent 三个方案在同一批样本上的质量与成本对比。
              数据来自 ai_eval_runs，只读展示。
            </p>
          </div>
        </div>
        <div className="notice">
          <FlaskConical size={16} />
          <div>
            还没有评测批次。在服务器上执行：
            <code className="mono"> node eval-run.cjs --variants heuristic,single_shot,agent </code>
            运行结束后刷新本页；样本集由 <code className="mono">scripts/eval/build-fixtures.ts</code>
            生成，存放在仓库外的 <code className="mono">.local-data/eval/</code>，不进版本库。
          </div>
        </div>
      </>
    );
  }

  const [summary, failures, samples] = await Promise.all([
    loadEvalVariantSummary(batch.batchId),
    loadEvalFailures(batch.batchId, 12),
    loadEvalDraftSamples(batch.batchId, 4),
  ]);

  const byFixture = new Map<string, typeof samples>();
  for (const sample of samples) {
    const list = byFixture.get(sample.fixtureId) || [];
    list.push(sample);
    byFixture.set(sample.fixtureId, list);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>上架评测</h1>
          <p>
            最近一次批次：{formatDateTime(batch.createdAt)} · {batch.fixtures} 条样本 ·{" "}
            {batch.variants.map(variantLabel).join(" / ")}。「可用」= Zod 通过 ∧ 零泄露 ∧
            无价格外露 ∧ 字段齐全 ∧ 长度合规 ∧ 买家规则抬到原文。
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-light btn-sm" href="/admin/shop/products">
            商品管理
          </Link>
          <Link className="btn btn-light btn-sm" href="/admin/metrics">
            API 指标
          </Link>
        </div>
      </div>

      <div className="analytics-split">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>质量对比</h2>
              <p>同一批样本下三个方案的结构合规与泄露情况。</p>
            </div>
          </div>
          <QualityChart rows={summary} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>成本对比</h2>
              <p>平均 token 与耗时；规则版不调用模型，成本为 0。</p>
            </div>
          </div>
          <CostChart rows={summary} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>方案明细</h2>
            <p>人工分是运营对草稿可用性的 1–5 打分，样本较少时仅供参考。</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>方案</th>
                <th>有效样本</th>
                <th>失败</th>
                <th>Zod 通过</th>
                <th>零泄露</th>
                <th>可用</th>
                <th>平均输入</th>
                <th>平均输出</th>
                <th>平均耗时</th>
                <th>人工分</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.variant}>
                  <td>{variantLabel(row.variant)}</td>
                  <td>{row.runs}</td>
                  <td className={row.errors > 0 ? "text-red" : undefined}>{row.errors}</td>
                  <td>{row.schemaValidPct.toFixed(1)}%</td>
                  <td className={row.leakFreePct < 100 ? "text-red" : undefined}>
                    {row.leakFreePct.toFixed(1)}%
                  </td>
                  <td className={row.usablePct < 100 ? "text-red" : undefined}>
                    {row.usablePct.toFixed(1)}%
                  </td>
                  <td>{row.avgInputTokens}</td>
                  <td>{row.avgOutputTokens}</td>
                  <td>{(row.avgLatencyMs / 1000).toFixed(2)}s</td>
                  <td>
                    {row.avgHumanScore === null
                      ? "—"
                      : `${row.avgHumanScore}（${row.ratedRuns} 条）`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {failures.length ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>不可用样本</h2>
              <p>按方案列出原因，先修共性问题再谈质量提升。</p>
            </div>
            <span className="badge">{failures.length} 条</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>方案</th>
                  <th>样本</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((row) => (
                  <tr key={`${row.variant}-${row.fixtureId}`}>
                    <td className="nowrap">{variantLabel(row.variant)}</td>
                    <td className="mono nowrap">{row.fixtureId}</td>
                    <td>
                      {row.error ? (
                        <span className="text-red">{row.error}</span>
                      ) : (
                        [
                          row.schemaErrors ? `Zod ${row.schemaErrors} 项` : "",
                          row.leakSamples.length ? `泄露 ${row.leakSamples.join("/")}` : "",
                          row.priceMentions ? `价格 ${row.priceMentions} 处` : "",
                          ...row.lengthIssues,
                        ]
                          .filter(Boolean)
                          .join("；")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {byFixture.size ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>人工抽查与打分</h2>
              <p>同一样本三个方案并排显示，按买家视角给 1–5 分。</p>
            </div>
          </div>
          <div className="panel-body eval-samples">
            {[...byFixture.entries()].map(([fixtureId, list]) => (
              <div key={fixtureId} className="eval-sample-block">
                <div className="eval-sample-head mono">样本 {fixtureId}</div>
                <div className="eval-sample-grid">
                  {list.map((sample) => (
                    <div key={sample.variant} className="eval-sample-card">
                      <div className="eval-sample-title">{variantLabel(sample.variant)}</div>
                      {sample.error ? (
                        <p className="text-red small">{sample.error}</p>
                      ) : (
                        <>
                          <p className="eval-sample-name">{sample.draft?.name || "（无标题）"}</p>
                          <p className="muted small">{sample.draft?.subtitle || ""}</p>
                          <details>
                            <summary className="small">查看完整草稿</summary>
                            <p className="small">{sample.draft?.description}</p>
                            <ul className="small">
                              {(sample.draft?.includes || []).map((line, index) => (
                                <li key={index}>· {line}</li>
                              ))}
                            </ul>
                            <ul className="small">
                              {(sample.draft?.usage || []).map((line, index) => (
                                <li key={index}>→ {line}</li>
                              ))}
                            </ul>
                          </details>
                        </>
                      )}
                      <EvalScoreForm
                        batchId={batch.batchId}
                        fixtureId={sample.fixtureId}
                        variant={sample.variant}
                        current={sample.humanScore}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>口径说明</h2>
            <p>评测结论只对这一批样本负责，不推断线上所有商品。</p>
          </div>
        </div>
        <div className="panel-body">
          <ul className="analytics-defs">
            <li>
              <strong>样本来源</strong>：未映射商品的货源正文，抓取后经
              sanitizeSupplierCopy 脱敏，冻结在仓库外的 .local-data/eval/fixtures.json。
            </li>
            <li>
              <strong>规则版</strong>：heuristicCopy，纯模板，不调用模型，是成本下限与质量下限。
            </li>
            <li>
              <strong>单轮模型</strong>：全文进 prompt 一次生成，等价于原线上 AI 分支。
            </li>
            <li>
              <strong>受控 Agent</strong>：多步工具循环（PR #168），有上限、有轨迹。
            </li>
            <li>
              <strong>买家规则</strong>：三个方案都由 extractNoticeCopy 逐行抬原文，模型不写
              notice/refund，因此「无价格外露」与「无编造承诺」是硬约束而非模型发挥。
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
