import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Gauge,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { updateOrderAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
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

  const [overviewResult, pendingResult, paidResult] = await Promise.all([
    query<{
      active_users: string;
      revenue_30d: string;
      paid_orders_30d: string;
      pending_orders: string;
      pending_ops: string;
      failed_ops: string;
      active_models: string;
      paused_models: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
        COALESCE((SELECT SUM(amount_micros) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '30 days'), 0) AS revenue_30d,
        (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '30 days') AS paid_orders_30d,
        (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
        (SELECT COUNT(*) FROM gateway_balance_ops WHERE status IN ('pending', 'failed', 'applying')) AS pending_ops,
        (SELECT COUNT(*) FROM gateway_balance_ops WHERE status = 'failed') AS failed_ops,
        (SELECT COUNT(*) FROM model_prices_current WHERE status = 'active') AS active_models,
        (SELECT COUNT(*) FROM model_prices_current WHERE status = 'paused') AS paused_models`,
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>运营概览</h1>
          <p>订单、网关和定价状态。</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-ghost btn-sm" href="/admin/orders">
            全部订单
          </Link>
          <Link className="btn btn-dark btn-sm" href="/admin/pricing">
            <SlidersHorizontal size={14} /> 定价
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

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">近 30 天收入</div>
          <div className="stat-value">
            {formatCny(toNumber(overview?.revenue_30d))}
          </div>
          <div className="stat-foot">
            {formatNumber(overview?.paid_orders_30d || 0)} 笔已支付
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">待支付订单</div>
          <div className="stat-value">{formatNumber(overview?.pending_orders || 0)}</div>
          <div className="stat-foot">需要跟进</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">待处理加额度</div>
          <div className="stat-value">{formatNumber(overview?.pending_ops || 0)}</div>
          <div className="stat-foot">失败 {formatNumber(overview?.failed_ops || 0)} 笔</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">模型</div>
          <div className="stat-value">{formatNumber(overview?.active_models || 0)}</div>
          <div className="stat-foot">
            暂停 {formatNumber(overview?.paused_models || 0)} 个
          </div>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>待支付订单</h2>
                <p>人工到账订单确认后自动加额度。</p>
              </div>
              <span className="badge badge-yellow">
                {formatNumber(overview?.pending_orders || 0)} 笔
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
                      <th>充值包</th>
                      <th>金额</th>
                      <th>方式</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingResult.rows.map((order) => (
                      <tr key={order.id}>
                        <td className="mono small">
                          {order.id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="small">{order.email}</td>
                        <td className="small">{order.plan_name}</td>
                        <td className="mono small">
                          {formatCny(toNumber(order.amount_micros))}
                        </td>
                        <td className="small">
                          {order.provider === "manual"
                            ? "人工"
                            : order.provider.startsWith("usdt_")
                              ? "USDT"
                              : order.provider === "alipay_easypay"
                                ? "支付宝"
                                : "Stripe"}
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
                            {order.provider === "manual" ? (
                              <form action={updateOrderAction}>
                                <input type="hidden" name="orderId" value={order.id} />
                                <input type="hidden" name="action" value="cancelled" />
                                <button className="btn btn-ghost btn-sm" type="submit">
                                  取消
                                </button>
                              </form>
                            ) : null}
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
              </div>
              <Link className="text-link small" href="/admin/orders">
                查看全部
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
                      <th>充值包</th>
                      <th>金额</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paidResult.rows.map((order) => (
                      <tr key={order.id}>
                        <td className="mono small">
                          {order.id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="small">{order.email}</td>
                        <td className="small">{order.plan_name}</td>
                        <td className="mono small">
                          {formatCny(toNumber(order.amount_micros))}
                        </td>
                        <td className="mono small nowrap">
                          {formatDateTime(order.paid_at)}
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
                <h2>快捷入口</h2>
              </div>
            </div>
            <div className="panel-body" style={{ display: "grid", gap: 8 }}>
              <Link className="btn btn-ghost btn-block" href="/admin/gateway">
                <Gauge size={14} /> 网关状态
              </Link>
              <Link className="btn btn-ghost btn-block" href="/admin/pricing">
                <SlidersHorizontal size={14} /> 定价与成本
              </Link>
              <Link className="btn btn-ghost btn-block" href="/admin/users">
                <Users size={14} /> 用户与额度
              </Link>
              <Link className="btn btn-ghost btn-block" href="/admin/plans">
                <CreditCard size={14} /> 充值包
              </Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>说明</h2>
            </div>
            <div className="panel-body">
              <p className="small muted" style={{ margin: 0 }}>
                用户余额以 Sub2API 为准。CokeAI 只负责订单、充值入账和运营展示。
                上游账号、模型与渠道在 Sub2API 后台维护。
              </p>
              <Link className="text-link small mt-12" href="/admin/gateway">
                查看接入方式 <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
