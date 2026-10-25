import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Info,
  Wallet,
} from "lucide-react";
import { cancelOrderAction } from "@/app/actions/billing";
import { CheckoutButton } from "@/components/CheckoutButton";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import {
  daysLeft,
  formatDateTime,
  formatFullDate,
  orderStatusLabel,
} from "@/lib/format";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "套餐与订单" };
export const dynamic = "force-dynamic";

type PlanRow = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  duration_days: number;
  features: unknown;
  highlight: boolean;
};

type OrderRow = {
  id: string;
  plan_name: string;
  amount_micros: string;
  credits_micros: string;
  status: string;
  payment_provider: string;
  provider_ref: string | null;
  paid_at: string | null;
  created_at: string;
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [plansResult, ordersResult, manualOrderResult] = await Promise.all([
    query<PlanRow>(
      `SELECT id, name, tagline, price_micros, credits_micros, duration_days, features, highlight
         FROM plans WHERE active = TRUE ORDER BY sort_order`,
    ),
    query<OrderRow>(
      `SELECT o.id, p.name AS plan_name, o.amount_micros, o.credits_micros,
              o.status, o.payment_provider, o.provider_ref, o.paid_at, o.created_at
         FROM orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
        LIMIT 30`,
      [user.id],
    ),
    params.order
      ? query<OrderRow>(
          `SELECT o.id, p.name AS plan_name, o.amount_micros, o.credits_micros,
                  o.status, o.payment_provider, o.provider_ref, o.paid_at, o.created_at
             FROM orders o JOIN plans p ON p.id = o.plan_id
            WHERE o.id = $1 AND o.user_id = $2
            LIMIT 1`,
          [params.order, user.id],
        )
      : Promise.resolve({ rows: [] as OrderRow[] }),
  ]);

  const manualOrder = manualOrderResult.rows[0];
  const remainingDays = daysLeft(user.plan_expires_at);
  const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>套餐与订单</h1>
          <p>购买后额度立即到账并激活有效期。当前所有套餐均为非自动续费。</p>
        </div>
        <div className="page-head-actions">
          <span className="badge badge-dark">余额 {formatCny(user.balance_micros)}</span>
        </div>
      </div>

      {params.welcome === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>账户已创建。选择一个套餐后即可开始调用 API。</div>
        </div>
      ) : null}

      {params.paid === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            支付已完成。额度到账由支付回调确认，通常几秒内完成；如状态仍为待支付，
            请稍后刷新页面。
          </div>
        </div>
      ) : null}

      {params.cancelled === "1" ? (
        <div className="notice">
          <Info size={16} />
          <div>支付已取消，未产生扣款。</div>
        </div>
      ) : null}

      {manualOrder && manualOrder.status === "pending" ? (
        <div className="notice">
          <Clock size={16} />
          <div>
            订单 <span className="mono">{manualOrder.id.slice(0, 8).toUpperCase()}</span> 已创建，
            金额 {formatCny(manualOrder.amount_micros)}。请通过{" "}
            <a className="text-link" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>{" "}
            联系客服获取收款信息，并在备注中填写完整订单号。管理员确认到账后额度自动发放。
            <form action={cancelOrderAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="orderId" value={manualOrder.id} />
              <button className="btn btn-ghost btn-sm" type="submit">
                取消该订单
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>当前账户</h2>
            <p>余额用于抵扣模型调用费用，与套餐有效期独立保留。</p>
          </div>
          <Wallet size={17} />
        </div>
        <div className="panel-body">
          <div className="grid-3">
            <div>
              <div className="small muted">可用余额</div>
              <div className="balance-amount">{formatCny(user.balance_micros)}</div>
            </div>
            <div>
              <div className="small muted">当前套餐</div>
              <div style={{ marginTop: 7, fontSize: 17, fontWeight: 750 }}>
                {user.plan_active ? user.plan_name : "未激活"}
              </div>
              <div className="small muted mt-8">
                {user.plan_expires_at
                  ? `${formatFullDate(user.plan_expires_at)} 到期`
                  : "购买套餐后激活 API 调用权限"}
              </div>
            </div>
            <div>
              <div className="small muted">剩余有效期</div>
              <div style={{ marginTop: 7, fontSize: 17, fontWeight: 750 }}>
                {remainingDays === null ? "—" : `${remainingDays} 天`}
              </div>
              <div className="small muted mt-8">
                {user.plan_active ? "续费可顺延同套餐有效期" : "到期不会自动扣费"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <h2 className="section-title">购买或续费套餐</h2>
      <div className="plan-grid">
        {plansResult.rows.map((plan) => {
          const features = Array.isArray(plan.features)
            ? (plan.features as string[])
            : [];
          const isCurrent = user.plan_active && user.plan_id === plan.id;
          return (
            <article
              key={plan.id}
              className={`plan-card${plan.highlight ? " highlight" : ""}`}
            >
              {plan.highlight ? <span className="plan-badge">Popular</span> : null}
              <h3 className="plan-name">{plan.name}</h3>
              <p className="plan-tagline">{plan.tagline}</p>
              <div className="plan-price">
                <strong>{formatCny(plan.price_micros).replace("¥", "")}</strong>
                <span>CNY / {plan.duration_days} 天</span>
              </div>
              <div className="plan-credit">
                <span>到账用量额度</span>
                <strong>{formatCny(plan.credits_micros)}</strong>
              </div>
              <ul className="plan-features">
                {features.map((feature) => (
                  <li key={feature}>
                    <Check size={13} /> {feature}
                  </li>
                ))}
              </ul>
              <div className="plan-actions">
                {config.stripeEnabled ? (
                  <CheckoutButton
                    planId={plan.id}
                    provider="stripe"
                    label={isCurrent ? "续费 · 在线支付" : "在线支付"}
                    className={`btn ${plan.highlight ? "btn-primary" : "btn-dark"} btn-block`}
                  />
                ) : null}
                {config.manualPaymentsEnabled ? (
                  <CheckoutButton
                    planId={plan.id}
                    provider="manual"
                    label="人工支付 / 对公转账"
                    className={`btn ${
                      plan.highlight ? "btn-light" : "btn-ghost"
                    } btn-block`}
                  />
                ) : null}
                {!config.stripeEnabled && !config.manualPaymentsEnabled ? (
                  <button className="btn btn-ghost btn-block" disabled>
                    支付暂未开放
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="notice mt-24">
        <CreditCard size={16} />
        <div>
          {config.stripeEnabled
            ? "在线支付由 Stripe 托管，支持银行卡等支付方式。"
            : "在线支付尚未配置。"}
          Stripe 币种由运营方配置，若你的卡组织不支持对应币种，请使用人工支付。
          支付成功但额度未到账时，请提供订单号联系客服，不要重复支付。
        </div>
      </div>

      <section className="panel mt-24">
        <div className="panel-head">
          <div>
            <h2>订单记录</h2>
            <p>人工支付订单由管理员确认；Stripe 订单由签名校验后的支付回调确认。</p>
          </div>
          <span className="badge">{ordersResult.rows.length} 条</span>
        </div>
        {ordersResult.rows.length === 0 ? (
          <div className="empty">还没有订单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>套餐</th>
                  <th>金额</th>
                  <th>方式</th>
                  <th>创建时间</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordersResult.rows.map((order) => {
                  const status = orderStatusLabel(order.status);
                  return (
                    <tr key={order.id}>
                      <td className="mono small">{order.id.slice(0, 8).toUpperCase()}</td>
                      <td>{order.plan_name}</td>
                      <td className="mono small">{formatCny(order.amount_micros)}</td>
                      <td className="small">
                        {order.payment_provider === "stripe" ? "Stripe" : "人工确认"}
                      </td>
                      <td className="mono small nowrap">
                        {formatDateTime(order.created_at)}
                      </td>
                      <td>
                        <span className={`badge ${status.className}`}>{status.label}</span>
                      </td>
                      <td className="text-right">
                        {order.status === "pending" && !order.provider_ref ? (
                          <form action={cancelOrderAction}>
                            <input type="hidden" name="orderId" value={order.id} />
                            <button className="btn btn-ghost btn-sm" type="submit">
                              取消
                            </button>
                          </form>
                        ) : order.status === "paid" ? (
                          <span className="small muted">
                            {order.paid_at ? formatDateTime(order.paid_at) : "已到账"}
                          </span>
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

      <div className="grid-2 mt-16">
        <div className="admin-form-card">
          <h3>
            <AlertTriangle size={14} /> 退款与异常
          </h3>
          <p className="small muted mb-0">
            未消耗额度可在购买后 72 小时内申请审核；已实际调用产生的费用无法退还。
            重复支付、支付成功但未到账，请联系{" "}
            <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a> 并提供订单号。
          </p>
        </div>
        <div className="admin-form-card">
          <h3>
            <ArrowRight size={14} /> 已有额度，下一步
          </h3>
          <p className="small muted">
            前往 API Key 页面创建凭证，再按文档发起第一个请求。
          </p>
          <Link className="btn btn-ghost btn-sm" href="/dashboard/keys">
            管理 API Key →
          </Link>
        </div>
      </div>
    </>
  );
}
