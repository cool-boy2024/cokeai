import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BookOpen,
  KeyRound,
  Sparkles,
  Wallet,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getGatewayBalanceForRequest as getGatewayBalance } from "@/lib/gateway-credits";
import { formatCny, formatCnyPrecise } from "@/lib/money";
import { ensureGatewayIdentityReady } from "@/lib/sub2api/identity";
import { getUserDashboardStats, getUserUsageTrend, listUserUsage } from "@/lib/sub2api/usage";

export const metadata: Metadata = { title: "概览" };
export const dynamic = "force-dynamic";

function shanghaiDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export default async function DashboardPage() {
  const user = await requireUser();

  let balance = user.balance_micros / 1_000_000;
  let stats = null as Awaited<ReturnType<typeof getUserDashboardStats>> | null;
  let recent = [] as Awaited<ReturnType<typeof listUserUsage>>["items"];
  let trend = [] as Awaited<ReturnType<typeof getUserUsageTrend>>;
  let gatewayError: string | null = null;

  try {
    const identity = await ensureGatewayIdentityReady(user.id);
    const [balanceResult, statsResult, recentResult, trendResult] = await Promise.all([
      getGatewayBalance(user.id),
      getUserDashboardStats(identity),
      listUserUsage(identity, { pageSize: 5 }),
      getUserUsageTrend(identity, shanghaiDate(-13), shanghaiDate(0)),
    ]);
    balance = balanceResult.balance;
    stats = statsResult;
    recent = recentResult.items || [];
    trend = trendResult;
  } catch (error) {
    gatewayError = error instanceof Error ? error.message : "网关暂不可用";
  }

  const maxTrend = Math.max(...trend.map((point) => point.actual_cost), 0.000001);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>概览</h1>
          <p>余额、用量和接入信息。</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-ghost btn-sm" href="/docs">
            <BookOpen size={14} /> 接入教程
          </Link>
          <Link className="btn btn-dark btn-sm" href="/dashboard/keys">
            <KeyRound size={14} /> 创建 Key
          </Link>
        </div>
      </div>

      {gatewayError ? (
        <div className="notice notice-red">
          <Activity size={16} />
          <div>网关状态暂不可用：{gatewayError}。余额和用量可能不是最新。</div>
        </div>
      ) : null}

      {!gatewayError && balance < config.lowBalanceCny ? (
        <div className="notice">
          <Wallet size={16} />
          <div>
            余额低于 {formatCny(config.lowBalanceCny * 1_000_000)}。
            <Link className="text-link" href="/dashboard/billing" style={{ marginLeft: 8 }}>
              立即充值 →
            </Link>
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            可用余额 <Wallet size={15} />
          </div>
          <div className="stat-value">{formatCny(balance * 1_000_000)}</div>
          <div className="stat-foot">人民币额度</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            今日消费 <Sparkles size={15} />
          </div>
          <div className="stat-value">
            {formatCny((stats?.today_actual_cost || 0) * 1_000_000)}
          </div>
          <div className="stat-foot">{formatNumber(stats?.today_requests || 0)} 次请求</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            累计请求 <Activity size={15} />
          </div>
          <div className="stat-value">{formatNumber(stats?.total_requests || 0)}</div>
          <div className="stat-foot">{formatNumber(stats?.active_api_keys || 0)} 个有效 Key</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">近 14 天消费</div>
          <div className="stat-value">
            {formatCny(
              trend.reduce((sum, point) => sum + point.actual_cost, 0) * 1_000_000,
            )}
          </div>
          <div className="stat-foot">按实际用量</div>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>近 14 天</h2>
                <p>每日消费</p>
              </div>
              <Link className="text-link small" href="/dashboard/usage">
                全部用量 →
              </Link>
            </div>
            <div className="panel-body">
              {trend.length === 0 ? (
                <div className="empty">暂无用量</div>
              ) : (
                <div className="mini-bars" aria-label="近 14 天消费趋势">
                  {trend.map((point) => (
                    <div className="mini-bar" key={point.date}>
                      <div
                        className="mini-bar-fill"
                        style={{
                          height: `${Math.max(4, (point.actual_cost / maxTrend) * 100)}%`,
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

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>最近请求</h2>
                <p>最近 5 条</p>
              </div>
            </div>
            {recent.length === 0 ? (
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
                    {recent.map((event) => (
                      <tr key={event.id}>
                        <td className="mono small nowrap">
                          {formatDateTime(event.created_at)}
                        </td>
                        <td className="mono small">{event.model || "—"}</td>
                        <td className="mono small">
                          {formatNumber(
                            (event.input_tokens || 0) + (event.output_tokens || 0),
                          )}
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

        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>接入教程</h2>
                <p>第一次调用从这里开始</p>
              </div>
              <BookOpen size={15} className="muted" />
            </div>
            <div className="panel-body">
              <p className="small muted" style={{ margin: 0 }}>
                Base URL、鉴权方式、流式输出和 Python / Node.js 示例，
                都整理在接入教程里。
              </p>
              <Link className="btn btn-ghost btn-sm btn-block mt-16" href="/docs">
                打开接入教程 <ArrowRight size={13} />
              </Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>账户</h2>
              </div>
            </div>
            <div className="panel-body">
              <div className="flex-between">
                <span className="small muted">邮箱</span>
                <span className="small">{user.email}</span>
              </div>
              <div className="flex-between mt-8">
                <span className="small muted">注册时间</span>
                <span className="small">{formatDateTime(user.created_at)}</span>
              </div>
              <Link
                className="btn btn-ghost btn-sm btn-block mt-16"
                href="/dashboard/settings"
              >
                账户设置 <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
