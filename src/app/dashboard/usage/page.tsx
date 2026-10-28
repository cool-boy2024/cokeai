import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Info } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatCny, formatCnyPrecise } from "@/lib/money";
import { ensureGatewayIdentityReady } from "@/lib/sub2api/identity";
import {
  getUserDashboardStats,
  getUserModelStats,
  getUserUsageTrend,
  listUserUsage,
} from "@/lib/sub2api/usage";

export const metadata: Metadata = { title: "用量" };
export const dynamic = "force-dynamic";

function shanghaiDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const range = [7, 30, 90].includes(Number(params.range)) ? Number(params.range) : 30;
  const startDate = shanghaiDate(-(range - 1));
  const endDate = shanghaiDate(0);

  let trend: Awaited<ReturnType<typeof getUserUsageTrend>> = [];
  let models: Awaited<ReturnType<typeof getUserModelStats>> = [];
  let usage: Awaited<ReturnType<typeof listUserUsage>>["items"] = [];
  let stats: Awaited<ReturnType<typeof getUserDashboardStats>> | null = null;
  let gatewayError: string | null = null;

  try {
    const identity = await ensureGatewayIdentityReady(user.id);
    const [trendResult, modelResult, usageResult, statsResult] = await Promise.all([
      getUserUsageTrend(identity, startDate, endDate),
      getUserModelStats(identity, startDate, endDate),
      listUserUsage(identity, { pageSize: 50, startDate, endDate }),
      getUserDashboardStats(identity),
    ]);
    trend = trendResult;
    models = modelResult;
    usage = usageResult.items || [];
    stats = statsResult;
  } catch (error) {
    gatewayError = error instanceof Error ? error.message : "网关暂不可用";
  }

  const totalCost = trend.reduce((sum, point) => sum + point.actual_cost, 0);
  const totalRequests = trend.reduce((sum, point) => sum + point.requests, 0);
  const totalTokens = trend.reduce((sum, point) => sum + point.total_tokens, 0);
  const maxDaily = Math.max(...trend.map((point) => point.actual_cost), 0.000001);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>用量</h1>
          <p>按模型和日期查看消费明细。</p>
        </div>
        <div className="page-head-actions">
          {[7, 30, 90].map((item) => (
            <Link
              key={item}
              className={`btn btn-sm ${range === item ? "btn-dark" : "btn-ghost"}`}
              href={`/dashboard/usage?range=${item}`}
            >
              {item} 天
            </Link>
          ))}
        </div>
      </div>

      {gatewayError ? (
        <div className="notice notice-red">
          <Activity size={16} />
          <div>用量暂不可用：{gatewayError}</div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">消费</div>
          <div className="stat-value">{formatCny(totalCost * 1_000_000)}</div>
          <div className="stat-foot">近 {range} 天</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">请求</div>
          <div className="stat-value">{formatNumber(totalRequests)}</div>
          <div className="stat-foot">今日 {formatNumber(stats?.today_requests || 0)} 次</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Token</div>
          <div className="stat-value">
            {totalTokens >= 1_000_000
              ? `${(totalTokens / 1_000_000).toFixed(1)}M`
              : totalTokens >= 1_000
                ? `${(totalTokens / 1_000).toFixed(1)}K`
                : formatNumber(totalTokens)}
          </div>
          <div className="stat-foot">输入 + 输出</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">累计消费</div>
          <div className="stat-value">
            {formatCny((stats?.total_actual_cost || 0) * 1_000_000)}
          </div>
          <div className="stat-foot">全部时间</div>
        </div>
      </div>

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>消费趋势</h2>
            <p>近 {range} 天</p>
          </div>
          <Info size={16} />
        </div>
        <div className="panel-body">
          {trend.length === 0 ? (
            <div className="empty">暂无用量</div>
          ) : (
            <div className="mini-bars" aria-label="消费趋势">
              {trend.map((point) => (
                <div className="mini-bar" key={point.date}>
                  <div
                    className="mini-bar-fill"
                    style={{
                      height: `${Math.max(4, (point.actual_cost / maxDaily) * 100)}%`,
                    }}
                    title={`${point.date}: ${formatCnyPrecise(
                      point.actual_cost * 1_000_000,
                    )}`}
                  />
                  <span>{point.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>模型分布</h2>
          </div>
          {models.length === 0 ? (
            <div className="empty">暂无用量</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求</th>
                    <th>Token</th>
                    <th>消费</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.model}>
                      <td className="mono small">{model.model}</td>
                      <td className="mono small">{formatNumber(model.requests)}</td>
                      <td className="mono small">{formatNumber(model.total_tokens)}</td>
                      <td className="mono small">
                        {formatCny(model.actual_cost * 1_000_000)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>最近请求</h2>
            <span className="badge">{usage.length} 条</span>
          </div>
          {usage.length === 0 ? (
            <div className="empty">还没有调用记录。</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模型</th>
                    <th>Token</th>
                    <th>费用</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((event) => (
                    <tr key={event.id}>
                      <td className="mono small nowrap">
                        {formatDateTime(event.created_at)}
                      </td>
                      <td className="mono small">{event.model || "—"}</td>
                      <td className="mono small">
                        {formatNumber((event.input_tokens || 0) + (event.output_tokens || 0))}
                      </td>
                      <td className="mono small">
                        {formatCnyPrecise((event.actual_cost || 0) * 1_000_000)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
