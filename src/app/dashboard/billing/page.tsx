import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, CreditCard, Wallet } from "lucide-react";
import { cancelOrderAction } from "@/app/actions/billing";
import { CheckoutButton } from "@/components/CheckoutButton";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { formatDateTime, orderStatusLabel } from "@/lib/format";
import { getGatewayBalanceForRequest as getGatewayBalance } from "@/lib/gateway-credits";
import { isEasyPayConfigured } from "@/lib/payments/easypay";
import { USDT_NETWORKS, isUsdtProvider, networkForProvider } from "@/lib/payments/networks";
import { configuredUsdtNetworks } from "@/lib/payments/usdt";
import { getManualAlipaySettings } from "@/lib/payments/settings";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "充值" };
export const dynamic = "force-dynamic";

type PlanRow = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
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
  pay_address: string | null;
  pay_expires_at: string | null;
  pay_txid: string | null;
  paid_at: string | null;
  created_at: string;
  credit_status: string | null;
};

function providerLabel(provider: string): string {
  const usdtNetwork = networkForProvider(provider);
  if (usdtNetwork) return USDT_NETWORKS[usdtNetwork].label;
  switch (provider) {
    case "alipay_manual":
    case "alipay_easypay":
      return "支付宝";
    case "stripe":
      return "银行卡";
    case "manual":
      return "人工到账";
    default:
      return provider;
  }
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [plansResult, ordersResult, balanceResult, personalAlipay] = await Promise.all([
    query<PlanRow>(
      `SELECT id, name, tagline, price_micros, credits_micros, highlight
         FROM plans WHERE active = TRUE ORDER BY sort_order`,
    ),
    query<OrderRow>(
      `SELECT o.id, p.name AS plan_name, o.amount_micros, o.credits_micros,
              o.status, o.payment_provider, o.provider_ref, o.pay_address,
              o.pay_expires_at, o.pay_txid, o.paid_at, o.created_at,
              g.status AS credit_status
         FROM orders o JOIN plans p ON p.id = o.plan_id
         LEFT JOIN gateway_balance_ops g ON g.order_id = o.id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
        LIMIT 30`,
      [user.id],
    ),
    getGatewayBalance(user.id).catch(() => ({
      balance: user.balance_micros / 1_000_000,
    })),
    getManualAlipaySettings(),
  ]);

  const pendingOrder = ordersResult.rows.find((order) => order.status === "pending");
  const manualOrder =
    pendingOrder?.status === "pending" && pendingOrder.payment_provider === "manual"
      ? pendingOrder
      : null;
  const usdtOrder =
    pendingOrder?.status === "pending" && isUsdtProvider(pendingOrder.payment_provider)
      ? pendingOrder
      : null;
  const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";
  const alipayReady = isEasyPayConfigured();
  const usdtNetworkIds = await configuredUsdtNetworks();
  const onlineMethods = [
    alipayReady || personalAlipay.enabled ? "支付宝" : null,
    usdtNetworkIds.length > 0 ? "USDT" : null,
    config.stripeEnabled ? "银行卡" : null,
  ].filter(Boolean);
  const hasOnline = onlineMethods.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>充值</h1>
          <p>1 元 = 1 额度，余额不过期。</p>
        </div>
        <div className="page-head-actions">
          <span className="badge badge-dark">余额 {formatCny(balanceResult.balance * 1_000_000)}</span>
        </div>
      </div>

      {params.welcome === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>账户已创建。充值后即可创建 Key 并调用 API。</div>
        </div>
      ) : null}

      {manualOrder ? (
        <div className="notice">
          <Clock size={16} />
          <div>
            订单 {manualOrder.id.slice(0, 8).toUpperCase()} 已创建，金额{" "}
            {formatCny(Number(manualOrder.amount_micros))}。请联系{" "}
            <a className="text-link" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>{" "}
            获取收款信息，并备注完整订单号。
            <form action={cancelOrderAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="orderId" value={manualOrder.id} />
              <button className="btn btn-ghost btn-sm" type="submit">
                取消订单
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {usdtOrder ? (
        <div className="notice">
          <Wallet size={16} />
          <div>
            有一笔 USDT 订单待支付。{" "}
            <Link className="text-link" href={`/dashboard/billing/usdt/${usdtOrder.id}`}>
              继续支付 →
            </Link>
          </div>
        </div>
      ) : null}

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>当前余额</h2>
            <p>用于抵扣模型调用费用。</p>
          </div>
          <Wallet size={17} />
        </div>
        <div className="panel-body">
          <div className="balance-amount">{formatCny(balanceResult.balance * 1_000_000)}</div>
          <div className="small muted mt-8">人民币额度</div>
        </div>
      </section>

      <div className="section-head">
        <div>
          <h2>选择充值金额</h2>
        </div>
        <p>
          支付方式：
          {[...onlineMethods, config.manualPaymentsEnabled ? "人工到账" : null]
            .filter(Boolean)
            .join(" / ") || "暂未开放"}
        </p>
      </div>

      <div className="plan-grid">
        {plansResult.rows.map((plan) => (
          <article
            key={plan.id}
            className={`plan-card${plan.highlight ? " highlight" : ""}`}
          >
            {plan.highlight ? <span className="plan-badge">推荐</span> : null}
            <h3 className="plan-name">{plan.name}</h3>
            <p className="plan-tagline">{plan.tagline}</p>
            <div className="plan-price">
              <strong>{formatCny(Number(plan.price_micros)).replace("¥", "")}</strong>
              <span>元</span>
            </div>
            <div className="plan-credit">
              <span>到账额度</span>
              <strong>{formatCny(Number(plan.credits_micros))}</strong>
            </div>
            <div className="plan-actions">
              {personalAlipay.enabled ? <CheckoutButton planId={plan.id} provider="alipay_manual" label="支付宝" className="btn btn-primary btn-block" /> : null}
              {alipayReady && !personalAlipay.enabled ? (
                <CheckoutButton
                  planId={plan.id}
                  provider="easypay"
                  label="支付宝"
                  className={`btn ${plan.highlight ? "btn-primary" : "btn-dark"} btn-block`}
                />
              ) : null}
              {usdtNetworkIds.map((network) => (
                <CheckoutButton
                  key={network}
                  planId={plan.id}
                  provider={USDT_NETWORKS[network].provider}
                  label={USDT_NETWORKS[network].label}
                  className="btn btn-ghost btn-block"
                />
              ))}
              {config.manualPaymentsEnabled && !personalAlipay.enabled ? (
                <CheckoutButton
                  planId={plan.id}
                  provider="manual"
                  label="人工到账"
                  className="btn btn-ghost btn-block"
                />
              ) : null}
              {config.stripeEnabled ? (
                <CheckoutButton
                  planId={plan.id}
                  provider="stripe"
                  label="银行卡"
                  className="btn btn-ghost btn-block"
                />
              ) : null}
              {!hasOnline && !config.manualPaymentsEnabled ? (
                <button className="btn btn-ghost btn-block" disabled>
                  支付暂未开放
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <section className="panel mt-24">
        <div className="panel-head">
          <div>
            <h2>订单记录</h2>
            <p>最近 30 笔</p>
          </div>
          <CreditCard size={17} />
        </div>
        {ordersResult.rows.length === 0 ? (
          <div className="empty">还没有订单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>充值包</th>
                  <th>金额</th>
                  <th>方式</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {ordersResult.rows.map((order) => {
                  const status = orderStatusLabel(order.status);
                  const creditPending =
                    order.status === "paid" && order.credit_status !== "applied";
                  return (
                    <tr key={order.id}>
                      <td className="mono small nowrap">{formatDateTime(order.created_at)}</td>
                      <td>{order.plan_name}{order.payment_provider === "alipay_manual" ? <div><Link className="text-link small" href={`/dashboard/billing/alipay/${order.id}`}>查看付款</Link></div> : null}</td>
                      <td className="mono small">{formatCny(Number(order.amount_micros))}</td>
                      <td className="small">{providerLabel(order.payment_provider)}</td>
                      <td>
                        {creditPending ? (
                          <span className="badge badge-yellow">额度待入账</span>
                        ) : (
                          <span className={`badge ${status.className}`}>{status.label}</span>
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
