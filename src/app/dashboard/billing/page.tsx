import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Sparkles,
  Wallet,
} from "lucide-react";
import { cancelOrderAction } from "@/app/actions/billing";
import { CustomRechargeForm } from "@/components/CustomRechargeForm";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, orderStatusLabel } from "@/lib/format";
import { getGatewayBalanceForRequest as getGatewayBalance } from "@/lib/gateway-credits";
import {
  checkoutProviderLabel,
  loadCheckoutMethods,
} from "@/lib/payments/methods";
import { isUsdtProvider } from "@/lib/payments/networks";
import { formatCny } from "@/lib/money";
import { getMembershipInfo } from "@/lib/shop/membership";

export const metadata: Metadata = { title: "充值" };
export const dynamic = "force-dynamic";

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

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const cancelBlocked = params.cancel === "blocked";

  const [ordersResult, balanceResult, checkout] = await Promise.all([
    query<OrderRow>(
      `SELECT o.id,
              CASE WHEN o.plan_id = 'custom' THEN '余额充值' ELSE p.name END AS plan_name,
              o.amount_micros, o.credits_micros,
              o.status, o.payment_provider, o.provider_ref, o.pay_address,
              o.pay_expires_at, o.pay_txid, o.paid_at, o.created_at,
              g.status AS credit_status
         FROM orders o JOIN plans p ON p.id = o.plan_id
         LEFT JOIN gateway_balance_ops g ON g.order_id = o.id
        WHERE o.user_id = $1 AND p.kind = 'topup'
        ORDER BY o.created_at DESC
        LIMIT 30`,
      [user.id],
    ),
    getGatewayBalance(user.id).catch(() => ({
      balance: user.balance_micros / 1_000_000,
    })),
    loadCheckoutMethods(),
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
  const membership = getMembershipInfo(user);
  const { methods, labels } = checkout;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>充值</h1>
          <p>自定义金额，充多少到多少，余额不过期。</p>
        </div>
        <div className="page-head-actions">
          <span className="badge badge-dark">余额 {formatCny(balanceResult.balance * 1_000_000)}</span>
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

      {params.welcome === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>账户已创建。充值后即可在小店下单。</div>
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
              <input type="hidden" name="returnTo" value="/dashboard/billing" />
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
            <p>可用于小店订单支付。</p>
          </div>
          <Wallet size={17} />
        </div>
        <div className="panel-body">
          <div className="balance-amount">{formatCny(balanceResult.balance * 1_000_000)}</div>
          <div className="small muted mt-8">账户余额</div>
        </div>
      </section>

      <div className="section-head">
        <div>
          <h2>充值金额</h2>
        </div>
        <p>支付方式：{labels.join(" / ") || "暂未开放"}</p>
      </div>

      <CustomRechargeForm methods={methods} />

      <Link href="/dashboard/membership" className="recharge-membership-link">
        <span className="recharge-membership-icon">
          <Sparkles size={16} />
        </span>
        <span>
          <strong>{membership.active ? "会员已生效" : "开通代理会员"}</strong>
          <span className="small muted">
            {membership.active
              ? "小店下单自动使用会员价。"
              : "会员期内小店全场会员价，适合长期拿货。"}
          </span>
        </span>
        <span className="recharge-membership-arrow">→</span>
      </Link>

      <section className="panel mt-24">
        <div className="panel-head">
          <div>
            <h2>充值记录</h2>
            <p>最近 30 笔</p>
          </div>
          <CreditCard size={17} />
        </div>
        {ordersResult.rows.length === 0 ? (
          <div className="empty">还没有充值记录。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
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
                      <td className="small">{checkoutProviderLabel(order.payment_provider)}</td>
                      <td>
                        {creditPending ? (
                          <span className="badge badge-yellow">余额待入账</span>
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
