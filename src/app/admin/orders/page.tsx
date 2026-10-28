import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ReceiptText } from "lucide-react";
import { updateOrderAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, orderStatusLabel } from "@/lib/format";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "充值订单" };
export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  email: string;
  user_name: string;
  plan_name: string;
  amount_micros: string;
  credits_micros: string;
  status: string;
  payment_provider: string;
  provider_ref: string | null;
  created_at: string;
  paid_at: string | null;
  credit_status: string | null;
};

const filters = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待支付" },
  { key: "paid", label: "已支付" },
  { key: "cancelled", label: "已取消" },
  { key: "refunded", label: "已退款" },
];

const providerLabels: Record<string, string> = {
  manual: "人工",
  alipay_easypay: "支付宝",
  alipay_manual: "支付宝（人工核实）",
  usdt_trc20: "USDT",
  stripe: "银行卡",
};

function creditBadge(status: string | null): { label: string; className: string } | null {
  if (!status) return null;
  if (status === "applied") return { label: "已入账", className: "badge-green" };
  return {
    label: "额度待入账",
    className: status === "failed" ? "badge-red" : "badge-yellow",
  };
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const requested = params.status || "all";
  const status = filters.some((item) => item.key === requested) ? requested : "all";

  const result = await query<OrderRow>(
    `SELECT o.id, u.email, u.name AS user_name, p.name AS plan_name,
            o.amount_micros, o.credits_micros, o.status, o.payment_provider,
            o.provider_ref, o.created_at, o.paid_at, g.status AS credit_status
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN plans p ON p.id = o.plan_id
       LEFT JOIN gateway_balance_ops g ON g.order_id = o.id
      WHERE ($1 = 'all' OR o.status = $1)
      ORDER BY o.created_at DESC
      LIMIT 200`,
    [status],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>充值订单</h1>
          <p>人工确认到账，额度经网关队列入账。</p>
        </div>
        <span className="badge badge-dark">
          <ReceiptText size={12} /> {result.rows.length} 条
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>订单操作已完成。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-8 mb-16">
        {filters.map((filter) => (
          <Link
            key={filter.key}
            href={`/admin/orders${filter.key === "all" ? "" : `?status=${filter.key}`}`}
            className={`btn btn-sm ${
              status === filter.key ? "btn-dark" : "btn-ghost"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>订单列表</h2>
          </div>
        </div>
        {result.rows.length === 0 ? (
          <div className="empty">当前筛选条件下没有订单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单</th>
                  <th>用户</th>
                  <th>充值包</th>
                  <th>金额 / 额度</th>
                  <th>支付方式</th>
                  <th>额度入账</th>
                  <th>创建时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((order) => {
                  const statusInfo = orderStatusLabel(order.status);
                  const credit = creditBadge(order.credit_status);
                  return (
                    <tr key={order.id}>
                      <td>
                        <span className="mono small">{order.id.slice(0, 8).toUpperCase()}</span>
                        {order.provider_ref ? (
                          <div
                            className="mono muted"
                            style={{ fontSize: 9, maxWidth: 120, overflow: "hidden" }}
                            title={order.provider_ref}
                          >
                            {order.provider_ref}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className="small">{order.email}</div>
                        <div className="small muted" style={{ fontSize: 9 }}>
                          {order.user_name}
                        </div>
                      </td>
                      <td className="small">{order.plan_name}</td>
                      <td>
                        <div className="mono small">{formatCny(order.amount_micros)}</div>
                        <div className="small muted" style={{ fontSize: 9 }}>
                          额度 {formatCny(order.credits_micros)}
                        </div>
                      </td>
                      <td className="small">
                        {providerLabels[order.payment_provider] || order.payment_provider}
                      </td>
                      <td>
                        {credit ? (
                          <span className={`badge ${credit.className}`}>{credit.label}</span>
                        ) : (
                          <span className="small muted">—</span>
                        )}
                      </td>
                      <td className="mono small nowrap">
                        {formatDateTime(order.created_at)}
                      </td>
                      <td>
                        <span className={`badge ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                        {order.paid_at ? (
                          <div className="small muted" style={{ fontSize: 9 }}>
                            {formatDateTime(order.paid_at)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {order.status === "pending" ? (
                          <div className="inline-form">
                            {["manual", "alipay_manual"].includes(order.payment_provider) ? <Link className="btn btn-primary btn-sm" href={`/admin/payments/review/${order.id}`}>核实到账</Link> : <span className="small muted">等待渠道确认</span>}
                            {order.payment_provider === "manual" ? (
                              <form action={updateOrderAction}>
                                <input type="hidden" name="orderId" value={order.id} />
                                <input type="hidden" name="action" value="cancelled" />
                                <button className="btn btn-ghost btn-sm" type="submit">
                                  取消
                                </button>
                              </form>
                            ) : null}
                          </div>
                        ) : (
                          <span className="small muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
