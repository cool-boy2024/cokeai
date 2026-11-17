import type { Metadata } from "next";
import Link from "next/link";
import {
  ErrorBars,
  LatencyHistogramChart,
  MinuteChart,
  ModelDonut,
  UsageTrendChart,
} from "@/components/admin/MetricsCharts";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import {
  METRICS_RANGES,
  METRICS_TIMEZONE,
  loadUsageMetrics,
  parseMetricsRange,
} from "@/lib/metrics";

export const metadata: Metadata = {
  title: "API 指标",
  robots: { index: false, follow: false },
};

// Operator data must never be cached by a shared proxy or the client router.
export const dynamic = "force-dynamic";

function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("zh-CN");
}

function successRateTone(pct: number | null): string {
  if (pct === null) return "";
  if (pct >= 99) return "metrics-rate-good";
  if (pct >= 95) return "metrics-rate-warn";
  return "metrics-rate-bad";
}

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const range = parseMetricsRange(params.range);
  const data = await loadUsageMetrics(range);
  const { overview, trend, minutes, models, errors, latency } = data;

  const rangeLabel = METRICS_RANGES.find((item) => item.value === range)?.label || "";
  const tokenTotal = overview.inputTokens + overview.outputTokens;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>API 指标</h1>
          <p>
            本地 usage_events 的请求量、延迟、成功率与成本：覆盖 Next.js 回滚网关
            与内部 LLM 任务。公网 /v1 流量由 Sub2API 计量，不并入这里，两套口径
            不混算。时间桶按 {METRICS_TIMEZONE} 切分。
          </p>
        </div>
        <div className="page-head-actions">
          <span className="badge">统计于 {formatDateTime(data.generatedAt)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-8 mb-16">
        {METRICS_RANGES.map((item) => (
          <Link
            key={item.value}
            href={`/admin/metrics?range=${item.value}`}
            className={`btn btn-sm ${range === item.value ? "btn-dark" : "btn-ghost"}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {overview.total === 0 ? (
        <div className="notice">
          <div>
            {rangeLabel}内没有本地计量数据。公网 /v1 流量走 Sub2API
            不落这张表；这里的曲线会随着回滚网关启用或内部 AI 任务运行逐步出现。
          </div>
        </div>
      ) : null}

      <section className="stat-grid" aria-label="请求总览">
        <div className="stat-card">
          <div className="stat-label">
            <span>请求数</span>
            <span>{rangeLabel}</span>
          </div>
          <div className="stat-value">{overview.total.toLocaleString("zh-CN")}</div>
          <div className="stat-foot">
            成功 {overview.succeeded} · 失败 {overview.failed}
            {overview.pending > 0 ? ` · 进行中 ${overview.pending}` : ""}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>成功率</span>
            <span>已完结请求</span>
          </div>
          <div className={`stat-value ${successRateTone(overview.successRatePct)}`}>
            {overview.successRatePct === null
              ? "—"
              : `${overview.successRatePct.toFixed(1)}%`}
          </div>
          <div className="stat-foot">
            {overview.succeeded + overview.failed > 0
              ? `${overview.succeeded + overview.failed} 个已完结样本`
              : "还没有已完结请求"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>P50 / P95 / P99</span>
            <span>响应延迟</span>
          </div>
          <div className="stat-value metrics-latency-value">
            {formatLatency(overview.p50Ms)}
          </div>
          <div className="stat-foot">
            P95 {formatLatency(overview.p95Ms)} · P99 {formatLatency(overview.p99Ms)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>Token 用量</span>
            <span>{rangeLabel}</span>
          </div>
          <div className="stat-value">{formatTokens(tokenTotal)}</div>
          <div className="stat-foot">
            输入 {formatTokens(overview.inputTokens)} · 输出{" "}
            {formatTokens(overview.outputTokens)}
            {overview.cacheReadTokens > 0
              ? ` · 缓存命中 ${formatTokens(overview.cacheReadTokens)}`
              : ""}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>上游成本</span>
            <span>{rangeLabel}</span>
          </div>
          <div className="stat-value">{formatCny(overview.upstreamCostMicros)}</div>
          <div className="stat-foot">
            计费 {formatCny(overview.chargedMicros)}
            {overview.internalRequests > 0
              ? ` · 内部任务 ${formatCny(overview.internalUpstreamCostMicros)}`
              : ""}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>请求趋势</h2>
            <p>
              {range === 1 ? "按小时" : "按天"}的成功/失败堆叠与 P95 延迟；
              空桶也会占位，缺口代表那段时间没有流量。
            </p>
          </div>
          <span className="badge">{overview.total.toLocaleString("zh-CN")} 次请求</span>
        </div>
        <UsageTrendChart points={trend} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>近 60 分钟</h2>
            <p>
              每分钟请求数（RPM）与 token 吞吐（TPM），不受上方时间范围影响，
              用来盯实时毛刺。
            </p>
          </div>
        </div>
        <MinuteChart points={minutes} />
      </section>

      <div className="analytics-split">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>模型分布</h2>
              <p>按请求数取前 7，其余并入排序之外。</p>
            </div>
          </div>
          <ModelDonut models={models} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>延迟分布</h2>
              <p>已完结请求按响应时长分桶，长尾向右。</p>
            </div>
          </div>
          <LatencyHistogramChart counts={latency.counts} />
        </section>
      </div>

      <div className="analytics-split analytics-bottom">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>错误码 Top</h2>
              <p>失败请求按 error_code 聚合，定位问题先看这里。</p>
            </div>
            {overview.failed > 0 ? (
              <span className="badge">{overview.failed} 次失败</span>
            ) : null}
          </div>
          <ErrorBars errors={errors} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>模型明细</h2>
              <p>每个模型的请求、成功率、P95 与成本。</p>
            </div>
          </div>
          {models.length === 0 ? (
            <div className="empty">所选时间范围内没有模型调用。</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求</th>
                    <th>成功率</th>
                    <th>P95</th>
                    <th>Tokens</th>
                    <th>上游成本</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const rate =
                      model.requests > 0
                        ? (model.succeeded / model.requests) * 100
                        : null;
                    return (
                      <tr key={model.modelId}>
                        <td className="mono">{model.modelId}</td>
                        <td>{model.requests}</td>
                        <td
                          className={
                            rate !== null && rate < 95 ? "text-red" : undefined
                          }
                        >
                          {rate === null ? "—" : `${rate.toFixed(1)}%`}
                        </td>
                        <td>{formatLatency(model.p95Ms)}</td>
                        <td>{formatTokens(model.inputTokens + model.outputTokens)}</td>
                        <td>{formatCny(model.upstreamCostMicros)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {overview.internalRequests > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>内部任务成本</h2>
              <p>
                小店 AI 上架等内部 LLM 任务单独记账，不向客户收费。共{" "}
                {overview.internalRequests} 次调用，上游成本{" "}
                {formatCny(overview.internalUpstreamCostMicros)}。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>口径说明</h2>
            <p>指标定义固定在此页，不接受任意筛选或导出。</p>
          </div>
        </div>
        <div className="panel-body">
          <ul className="analytics-defs">
            <li>
              <strong>数据源</strong>：本地 usage_events 表。公网 /v1
              由 Sub2API 鉴权计费，不写入本表；这里看到的是 Next.js
              回滚网关与内部任务（internal = true）的调用。
            </li>
            <li>
              <strong>成功率</strong>：成功 ÷（成功 + 失败），
              进行中的预留不计入分母。
            </li>
            <li>
              <strong>P50 / P95 / P99</strong>：已完结请求的延迟分位数
              （percentile_cont），进行中与无延迟样本的请求不计入。
            </li>
            <li>
              <strong>Token</strong>：输入 + 输出；缓存命中单独展示，
              不从输入里扣减。
            </li>
            <li>
              <strong>上游成本</strong>：按模型牌价折算的成本；
              计费金额是实际从余额扣除的 charged_micros。
            </li>
            <li>
              <strong>数据保护</strong>：页面在 /admin 权限体系内，仅返回聚合值，
              不展示调用内容、Key 或客户身份。
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
