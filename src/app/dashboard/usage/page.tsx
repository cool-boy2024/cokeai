import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Info } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import {
  compactNumber,
  formatDateTime,
  formatNumber,
  usageStatusLabel,
} from "@/lib/format";
import { formatCny, formatCnyPrecise } from "@/lib/money";

export const metadata: Metadata = { title: "用量账单" };
export const dynamic = "force-dynamic";

type DailyRow = { day: string; requests: string; tokens: string; charged: string };
type ModelRow = { model_id: string; requests: string; tokens: string; charged: string };
type UsageRow = {
  id: string;
  model_id: string;
  api_key_id: string | null;
  input_tokens: string;
  output_tokens: string;
  charged_micros: string;
  status: string;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
};

export default async function UsagePage() {
  const user = await requireUser();

  const [totalsResult, dailyResult, modelResult, eventsResult] = await Promise.all([
    query<{
      requests: string;
      input_tokens: string;
      output_tokens: string;
      charged: string;
      failures: string;
    }>(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(charged_micros), 0) AS charged,
              COUNT(*) FILTER (WHERE status = 'failed') AS failures
         FROM usage_events
        WHERE user_id = $1 AND created_at >= now() - interval '30 days'`,
      [user.id],
    ),
    query<DailyRow>(
      `WITH days AS (
         SELECT generate_series(
           (now() AT TIME ZONE 'Asia/Shanghai')::date - 13,
           (now() AT TIME ZONE 'Asia/Shanghai')::date,
           interval '1 day'
         )::date AS day
       )
       SELECT to_char(d.day, 'MM-DD') AS day,
              COUNT(e.id) AS requests,
              COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,
              COALESCE(SUM(e.charged_micros), 0) AS charged
         FROM days d
         LEFT JOIN usage_events e
           ON e.user_id = $1
          AND (e.created_at AT TIME ZONE 'Asia/Shanghai')::date = d.day
         GROUP BY d.day
         ORDER BY d.day`,
      [user.id],
    ),
    query<ModelRow>(
      `SELECT model_id,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(charged_micros), 0) AS charged
         FROM usage_events
        WHERE user_id = $1 AND created_at >= now() - interval '30 days'
        GROUP BY model_id
        ORDER BY charged DESC`,
      [user.id],
    ),
    query<UsageRow>(
      `SELECT id, model_id, api_key_id, input_tokens, output_tokens, charged_micros,
              status, latency_ms, error_code, created_at
         FROM usage_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [user.id],
    ),
  ]);

  const totals = totalsResult.rows[0];
  const totalRequests = toNumber(totals?.requests);
  const totalTokens = toNumber(totals?.input_tokens) + toNumber(totals?.output_tokens);
  const totalCharged = toNumber(totals?.charged);
  const failures = toNumber(totals?.failures);
  const successRate = totalRequests
    ? (((totalRequests - failures) / totalRequests) * 100).toFixed(1)
    : "—";
  const maxDaily = Math.max(...dailyResult.rows.map((row) => toNumber(row.charged)), 1);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>用量账单</h1>
          <p>按真实 Token 计费，费用与余额实时对应。只保留计量元数据。</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/dashboard/billing">
          余额 {formatCny(user.balance_micros)}
        </Link>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">近 30 天消费</div>
          <div className="stat-value">{formatCny(totalCharged)}</div>
          <div className="stat-foot">按实际完成请求结算</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">请求数</div>
          <div className="stat-value">{formatNumber(totalRequests)}</div>
          <div className="stat-foot">成功 {successRate}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Token 总量</div>
          <div className="stat-value">{compactNumber(totalTokens)}</div>
          <div className="stat-foot">
            输入 {compactNumber(totals?.input_tokens || 0)} · 输出{" "}
            {compactNumber(totals?.output_tokens || 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">失败请求</div>
          <div className="stat-value">{formatNumber(failures)}</div>
          <div className="stat-foot">失败请求不收取模型费用</div>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>近 14 天消费</h2>
                <p>按北京时间自然日聚合。</p>
              </div>
              <Activity size={17} />
            </div>
            <div className="panel-body">
              {dailyResult.rows.map((row) => {
                const value = toNumber(row.charged);
                return (
                  <div className="bar-row" key={row.day}>
                    <span className="mono small muted">{row.day}</span>
                    <div className="bar-track">
                      <span
                        style={{
                          width: `${Math.max(value > 0 ? 3 : 0, (value / maxDaily) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="bar-value">
                      {value > 0 ? formatCnyPrecise(value) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>最近 50 条请求</h2>
                <p>不展示提示词或模型输出。</p>
              </div>
            </div>
            {eventsResult.rows.length === 0 ? (
              <div className="empty">还没有请求记录。</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>模型</th>
                      <th>输入</th>
                      <th>输出</th>
                      <th>费用</th>
                      <th>延迟</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventsResult.rows.map((event) => {
                      const status = usageStatusLabel(event.status);
                      return (
                        <tr key={event.id}>
                          <td className="mono small nowrap">
                            {formatDateTime(event.created_at)}
                          </td>
                          <td className="mono small">{event.model_id}</td>
                          <td className="mono small">{formatNumber(event.input_tokens)}</td>
                          <td className="mono small">{formatNumber(event.output_tokens)}</td>
                          <td className="mono small">
                            {formatCnyPrecise(event.charged_micros)}
                          </td>
                          <td className="mono small">
                            {event.latency_ms ? `${event.latency_ms}ms` : "—"}
                          </td>
                          <td>
                            <span className={`badge ${status.className}`}>
                              {status.label}
                            </span>
                            {event.error_code ? (
                              <div className="small muted mono" style={{ fontSize: 9 }}>
                                {event.error_code}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
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
                <h2>模型拆分</h2>
                <p>近 30 天费用分布。</p>
              </div>
            </div>
            {modelResult.rows.length === 0 ? (
              <div className="empty">暂无数据。</div>
            ) : (
              <div className="panel-body">
                {modelResult.rows.map((model) => {
                  const value = toNumber(model.charged);
                  const share = totalCharged
                    ? Math.round((value / totalCharged) * 100)
                    : 0;
                  return (
                    <div className="mb-16" key={model.model_id}>
                      <div className="flex-between">
                        <span className="mono small">{model.model_id}</span>
                        <span className="small">{formatCny(value)}</span>
                      </div>
                      <div className="progress mt-8">
                        <span style={{ width: `${Math.max(share, 2)}%` }} />
                      </div>
                      <div className="small muted mt-8" style={{ fontSize: 9 }}>
                        {formatNumber(model.requests)} 次 · {compactNumber(model.tokens)} Token
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="notice">
            <Info size={15} />
            <div>
              费用 = 输入 Token × 输入单价 + 输出 Token × 输出单价。请求失败时全额释放预授权，
              不产生扣费。
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
