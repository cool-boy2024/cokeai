import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Gift,
  Server,
  Users,
} from "lucide-react";
import { payCommissionAction, updateOrderAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatDateTime, formatNumber, orderStatusLabel } from "@/lib/format";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "运营概览" };
export const dynamic = "force-dynamic";

type PendingOrder = {
  id: string;
  email: string;
  plan_name: string;
  amount_micros: string;
  provider: string;
  created_at: string;
};

type Commission = {
  id: string;
  amount_micros: string;
  referrer_email: string;
  buyer_email: string;
  available_at: string;
};

type PaidOrder = {
  id: string;
  email: string;
  plan_name: string;
  amount_micros: string;
  paid_at: string;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [overviewResult, pendingResult, commissionResult, paidResult] =
    await Promise.all([
      query<{
        active_users: string;
        revenue_30d: string;
        paid_orders_30d: string;
        charged_30d: string;
        upstream_30d: string;
        requests_30d: string;
        failures_30d: string;
        pending_orders: string;
        liabilities: string;
        commission_available: string;
        ready_models: string;
      }>(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
          COALESCE((SELECT SUM(amount_micros) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '30 days'), 0) AS revenue_30d,
          (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '30 days') AS paid_orders_30d,
          COALESCE((SELECT SUM(charged_micros) FROM usage_events WHERE status = 'succeeded' AND created_at >= now() - interval '30 days'), 0) AS charged_30d,
          COALESCE((SELECT SUM(upstream_cost_micros) FROM usage_events WHERE status = 'succeeded' AND created_at >= now() - interval '30 days'), 0) AS upstream_30d,
          (SELECT COUNT(*) FROM usage_events WHERE created_at >= now() - interval '30 days') AS requests_30d,
          (SELECT COUNT(*) FROM usage_events WHERE created_at >= now() - interval '30 days' AND status = 'failed') AS failures_30d,
          (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
          COALESCE((SELECT SUM(balance_micros) FROM users WHERE status = 'active'), 0) AS liabilities,
          COALESCE((SELECT SUM(amount_micros) FROM commissions WHERE status = 'available'), 0) AS commission_available,
          (SELECT COUNT(*) FROM models m JOIN upstreams u ON u.id = m.upstream_id
            WHERE m.enabled = TRUE AND u.enabled = TRUE AND u.api_key_encrypted IS NOT NULL) AS ready_models`,
      ),
      query<PendingOrder>(
        `SELECT o.id, u.email, p.name AS plan_name, o.amount_micros,
                o.payment_provider AS provider, o.created_at
           FROM orders o
           JOIN users u ON u.id = o.user_id
           JOIN plans p ON p.id = o.plan_id
          WHERE o.status = 'pending'
          ORDER BY o.created_at
          LIMIT 12`,
      ),
      query<Commission>(
        `SELECT c.id, c.amount_micros, r.email AS referrer_email,
                b.email AS buyer_email, c.available_at
           FROM commissions c
           JOIN users r ON r.id = c.referrer_id
           JOIN users b ON b.id = c.buyer_id
          WHERE c.status = 'available'
          ORDER BY c.available_at
          LIMIT 12`,
      ),
      query<PaidOrder>(
        `SELECT o.id, u.email, p.name AS plan_name, o.amount_micros, o.paid_at
           FROM orders o
           JOIN users u ON u.id = o.user_id
           JOIN plans p ON p.id = o.plan_id
          WHERE o.status = 'paid'
          ORDER BY o.paid_at DESC
          LIMIT 8`,
      ),
    ]);

  const overview = overviewResult.rows[0];
  const revenue30d = toNumber(overview?.revenue_30d);
  const charged30d = toNumber(overview?.charged_30d);
  const upstream30d = toNumber(overview?.upstream_30d);
  const margin = charged30d - upstream30d;
  const marginPercent = charged30d ? Math.round((margin / charged30d) * 100) : 0;
  const requests30d = toNumber(overview?.requests_30d);
  const failures30d = toNumber(overview?.failures_30d);
  const readyModels = toNumber(overview?.ready_models);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>运营概览</h1>
          <p>订单、用量、上游就绪度与待办事项。所有金额为人民币内部账本值。</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-ghost btn-sm" href="/admin/orders">
            全部订单
          </Link>
          <Link className="btn btn-dark btn-sm" href="/admin/models">
            <Server size={14} /> 配置模型
          </Link>
        </div>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>操作已保存。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}
      {readyModels === 0 ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>
            当前没有可用的模型。请先在
            <Link className="text-link" href="/admin/models" style={{ margin: "0 4px" }}>
              模型与上游
            </Link>
            页面配置 API Key、启用上游并启用模型，否则所有 API 请求都会失败。
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            近 30 天订单收入 <Banknote size={15} />
          </div>
          <div className="stat-value">{formatCny(revenue30d)}</div>
          <div className="stat-foot">
            {formatNumber(overview?.paid_orders_30d || 0)} 笔已支付
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            近 30 天模型消耗 <CreditCard size={15} />
          </div>
          <div className="stat-value">{formatCny(charged30d)}</div>
          <div className="stat-foot">上游成本 {formatCny(upstream30d)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            用量毛利 <ArrowRight size={15} />
          </div>
          <div className="stat-value">{formatCny(margin)}</div>
          <div className="stat-foot">
            毛利率 {marginPercent}% · 不含服务器与获客
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            活跃用户 <Users size={15} />
          </div>
          <div className="stat-value">{formatNumber(overview?.active_users || 0)}</div>
          <div className="stat-foot">{formatNumber(requests30d)} 次请求</div>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>待处理订单</h2>
                <p>人工支付订单确认到账后，额度与套餐自动发放。</p>
              </div>
              <span className="badge badge-yellow">
                {formatNumber(overview?.pending_orders || 0)} 笔待处理
              </span>
            </div>
            {pendingResult.rows.length === 0 ? (
              <div className="empty">没有待处理订单。</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>订单</th>
                      <th>用户</th>
                      <th>套餐</th>
                      <th>金额</th>
                      <th>方式</th>
                      <th>创建</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingResult.rows.map((order) => (
                      <tr key={order.id}>
                        <td className="mono small">{order.id.slice(0, 8).toUpperCase()}</td>
                        <td className="small">{order.email}</td>
                        <td className="small">{order.plan_name}</td>
                        <td className="mono small">{formatCny(order.amount_micros)}</td>
                        <td className="small">
                          {order.provider === "stripe" ? "Stripe" : "人工"}
                        </td>
                        <td className="mono small nowrap">
                          {formatDateTime(order.created_at)}
                        </td>
                        <td>
                          <div className="inline-form">
                            <form action={updateOrderAction}>
                              <input type="hidden" name="orderId" value={order.id} />
                              <input type="hidden" name="action" value="paid" />
                              <button className="btn btn-primary btn-sm" type="submit">
                                确认到账
                              </button>
                            </form>
                            <form action={updateOrderAction}>
                              <input type="hidden" name="orderId" value={order.id} />
                              <input type="hidden" name="action" value="cancelled" />
                              <button className="btn btn-ghost btn-sm" type="submit">
                                取消
                              </button>
                            </form>
                          </div>
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
              <div>
                <h2>最近到账</h2>
                <p>已完成的收入事件。</p>
              </div>
              <Link className="text-link small" href="/admin/orders">
                查看全部 →
              </Link>
            </div>
            {paidResult.rows.length === 0 ? (
              <div className="empty">还没有已支付订单。</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>订单</th>
                      <th>用户</th>
                      <th>套餐</th>
                      <th>金额</th>
                      <th>支付时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paidResult.rows.map((order) => (
                      <tr key={order.id}>
                        <td className="mono small">{order.id.slice(0, 8).toUpperCase()}</td>
                        <td className="small">{order.email}</td>
                        <td className="small">{order.plan_name}</td>
                        <td className="mono small">{formatCny(order.amount_micros)}</td>
                        <td className="mono small nowrap">{formatDateTime(order.paid_at)}</td>
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
              <h2>财务健康</h2>
              <Banknote size={17} />
            </div>
            <div className="panel-body">
              <div className="flex-between mb-12">
                <span className="small muted">用户余额负债</span>
                <strong className="small">{formatCny(overview?.liabilities || 0)}</strong>
              </div>
              <div className="flex-between mb-12">
                <span className="small muted">可结算佣金</span>
                <strong className="small">
                  {formatCny(overview?.commission_available || 0)}
                </strong>
              </div>
              <div className="flex-between mb-12">
                <span className="small muted">近 30 天失败请求</span>
                <strong className="small">{formatNumber(failures30d)}</strong>
              </div>
              <div className="flex-between">
                <span className="small muted">失败率</span>
                <strong className="small">
                  {requests30d
                    ? `${((failures30d / requests30d) * 100).toFixed(1)}%`
                    : "—"}
                </strong>
              </div>
              <div className="notice mt-16" style={{ marginBottom: 0 }}>
                用户余额是未来的服务义务；不要把未消耗充值当作可自由支配利润。
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>待结算佣金</h2>
                <p>线下完成打款后再标记已结算。</p>
              </div>
              <Gift size={17} />
            </div>
            {commissionResult.rows.length === 0 ? (
              <div className="empty">没有待结算佣金。</div>
            ) : (
              <div className="panel-body">
                {commissionResult.rows.map((item) => (
                  <div
                    key={item.id}
                    className="flex-between"
                    style={{
                      paddingBottom: 12,
                      marginBottom: 12,
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <div>
                      <div className="small">{item.referrer_email}</div>
                      <div className="small muted" style={{ fontSize: 9 }}>
                        来自 {item.buyer_email}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono small">{formatCny(item.amount_micros)}</div>
                      <form action={payCommissionAction} className="mt-8">
                        <input type="hidden" name="commissionId" value={item.id} />
                        <button className="btn btn-ghost btn-sm" type="submit">
                          标记已结算
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="notice">
            <Clock size={15} />
            <div>
              定时对账、健康检查与提醒由 n8n 工作流负责。内部接口使用单独的 secret，
              不与用户会话共享。
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
