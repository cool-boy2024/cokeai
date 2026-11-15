import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  Sparkles,
} from "lucide-react";
import { cancelOrderAction } from "@/app/actions/billing";
import { CheckoutButton } from "@/components/CheckoutButton";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { daysLeft, formatDateTime, formatFullDate, orderStatusLabel } from "@/lib/format";
import {
  checkoutProviderLabel,
  loadCheckoutMethods,
} from "@/lib/payments/methods";
import { isUsdtProvider } from "@/lib/payments/networks";
import { formatCny } from "@/lib/money";
import {
  getMembershipInfo,
  memberDiscountLabel,
} from "@/lib/shop/membership";

export const metadata: Metadata = { title: "会员中心" };
export const dynamic = "force-dynamic";

type MembershipPlanRow = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  duration_days: number;
  shop_discount_bps: number;
};

type OrderRow = {
  id: string;
  plan_name: string;
  amount_micros: string;
  status: string;
  payment_provider: string;
  created_at: string;
  paid_at: string | null;
};

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const flags = await searchParams;
  const cancelBlocked =
    (Array.isArray(flags.cancel) ? flags.cancel[0] : flags.cancel) === "blocked";
  const [plansResult, ordersResult, checkout] = await Promise.all([
    query<MembershipPlanRow>(
      `SELECT id, name, tagline, price_micros, duration_days, shop_discount_bps
         FROM plans
        WHERE active = TRUE AND kind = 'membership'
        ORDER BY sort_order ASC, created_at ASC`,
    ),
    query<OrderRow>(
      `SELECT o.id, p.name AS plan_name, o.amount_micros, o.status,
              o.payment_provider, o.created_at, o.paid_at
         FROM orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.user_id = $1 AND p.kind = 'membership'
        ORDER BY o.created_at DESC
        LIMIT 20`,
      [user.id],
    ),
    loadCheckoutMethods(),
  ]);

  const membership = getMembershipInfo(user);
  const remaining = daysLeft(membership.expiresAt);
  const pendingOrder = ordersResult.rows.find((order) => order.status === "pending");
  // Mirrors cancelOrderAction: providers outside this list cannot be cancelled
  // by the buyer, so do not render a button that cannot work.
  const cancellable = pendingOrder
    ? [
        "manual",
        "alipay_manual",
        "alipay_easypay",
        "usdt_trc20",
        "usdt_bsc",
        "usdt_polygon",
      ].includes(pendingOrder.payment_provider)
    : false;
  const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";
  const { methods, labels } = checkout;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>会员中心</h1>
          <p>会员期内小店下单自动使用会员价，适合长期拿货与代理合作。</p>
        </div>
        <div className="page-head-actions">
          <span className={`badge ${membership.active ? "badge-green" : "badge"}`}>
            {membership.active ? "会员生效中" : "未开通"}
          </span>
        </div>
      </div>

      {cancelBlocked ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>
            这笔订单已有付款记录，暂时不能自助取消。请先
            <Link className="text-link" href="/dashboard/support">
              联系客服
            </Link>
            核对，避免重复付款。
          </div>
        </div>
      ) : null}

      {pendingOrder ? (
        <div className="notice">
          <Clock size={16} />
          <div>
            会员订单 {pendingOrder.id.slice(0, 8).toUpperCase()} 待支付，金额{" "}
            {formatCny(Number(pendingOrder.amount_micros))}。
            {pendingOrder.payment_provider === "alipay_manual" ? (
              <>
                {" "}
                <Link
                  className="text-link"
                  href={`/dashboard/billing/alipay/${pendingOrder.id}?flow=membership`}
                >
                  继续付款 →
                </Link>
              </>
            ) : isUsdtProvider(pendingOrder.payment_provider) ? (
              <>
                {" "}
                <Link
                  className="text-link"
                  href={`/dashboard/billing/usdt/${pendingOrder.id}?flow=membership`}
                >
                  继续付款 →
                </Link>
              </>
            ) : pendingOrder.payment_provider === "manual" ? (
              <>
                {" "}
                请联系{" "}
                <a className="text-link" href={`mailto:${supportEmail}`}>
                  {supportEmail}
                </a>{" "}
                获取收款信息，并备注完整订单号。
              </>
            ) : null}
            {cancellable ? (
              <form action={cancelOrderAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="orderId" value={pendingOrder.id} />
                <input
                  type="hidden"
                  name="returnTo"
                  value="/dashboard/membership"
                />
                <button className="btn btn-ghost btn-sm" type="submit">
                  取消订单
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>{membership.active ? "我的会员" : "会员权益"}</h2>
            <p>
              {membership.active
                ? "会员价在商品页与结算时自动应用。"
                : "开通后立即生效，到期自动恢复原价。"}
            </p>
          </div>
          <Crown size={17} />
        </div>
        <div className="panel-body membership-facts">
          <div>
            <span>小店会员价</span>
            <strong>
              {membership.active ? memberDiscountLabel(membership.discountBps) : "—"}
            </strong>
          </div>
          <div>
            <span>到期时间</span>
            <strong>{membership.active ? formatFullDate(membership.expiresAt) : "—"}</strong>
          </div>
          <div>
            <span>剩余天数</span>
            <strong>{membership.active ? `${remaining} 天` : "—"}</strong>
          </div>
        </div>
      </section>

      {membership.active ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            当前会员计划：{user.plan_name || "会员"}。会员价不会低于货源成本，
            个别商品可能不再额外折扣。
          </div>
        </div>
      ) : null}

      <div className="section-head">
        <div>
          <h2>{membership.active ? "续费会员" : "开通会员"}</h2>
        </div>
        <p>支付方式：{labels.join(" / ") || "暂未开放"}</p>
      </div>

      {plansResult.rows.length === 0 ? (
        <div className="empty">会员暂未开放，请稍后再来。</div>
      ) : (
        <div className="plan-grid membership-plans">
          {plansResult.rows.map((plan) => {
            const discount = memberDiscountLabel(plan.shop_discount_bps);
            return (
              <article key={plan.id} className="plan-card highlight">
                <span className="plan-badge">会员</span>
                <h3 className="plan-name">{plan.name}</h3>
                <p className="plan-tagline">
                  {plan.tagline || `有效期 ${plan.duration_days} 天`}
                </p>
                <div className="plan-price">
                  <strong>{formatCny(Number(plan.price_micros)).replace("¥", "")}</strong>
                  <span>/ {plan.duration_days} 天</span>
                </div>
                <div className="plan-credit">
                  <span>小店会员价</span>
                  <strong>{discount}</strong>
                </div>
                <ul className="plan-features">
                  <li>
                    <Sparkles size={13} /> 小店全部商品会员价
                  </li>
                  <li>
                    <Sparkles size={13} /> 会员期内有效，续费叠加时长
                  </li>
                  <li>
                    <Sparkles size={13} /> 适合长期拿货与代理合作
                  </li>
                </ul>
                <div className="plan-actions">
                  {methods.length === 0 ? (
                    <button className="btn btn-ghost btn-block" type="button" disabled>
                      支付暂未开放
                    </button>
                  ) : (
                    methods.map((method) => (
                      <CheckoutButton
                        key={method.provider}
                        planId={plan.id}
                        provider={method.provider}
                        label={method.label}
                        className={method.className}
                        flow="membership"
                      />
                    ))
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="panel mt-24">
        <div className="panel-head">
          <div>
            <h2>会员订单</h2>
            <p>最近 20 笔</p>
          </div>
          <CreditCard size={17} />
        </div>
        {ordersResult.rows.length === 0 ? (
          <div className="empty">还没有会员订单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>计划</th>
                  <th>金额</th>
                  <th>方式</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {ordersResult.rows.map((order) => {
                  const status = orderStatusLabel(order.status);
                  return (
                    <tr key={order.id}>
                      <td className="mono small nowrap">{formatDateTime(order.created_at)}</td>
                      <td>{order.plan_name}</td>
                      <td className="mono small">{formatCny(Number(order.amount_micros))}</td>
                      <td className="small">{checkoutProviderLabel(order.payment_provider)}</td>
                      <td>
                        <span className={`badge ${status.className}`}>{status.label}</span>
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
