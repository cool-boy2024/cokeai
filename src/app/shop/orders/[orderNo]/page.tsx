import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Headset } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AutoRefresh } from "@/components/shop/AutoRefresh";
import { DeliveryReveal } from "@/components/shop/DeliveryReveal";
import { OrderTimeline } from "@/components/shop/OrderTimeline";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { USDT_NETWORKS, networkForProvider } from "@/lib/payments/networks";
import { formatCny } from "@/lib/money";
import { decryptCustomerInput, findShopOrderByNo } from "@/lib/shop/orders";
import { SHOP_COPY } from "@/lib/shop/copy";
import { loadCustomerOrderEvents } from "@/lib/shop/customer-events";
import { listTicketsForOrder } from "@/lib/support";

function paymentLabel(provider: string): string {
  if (provider === "alipay_easypay") return "支付宝（易支付）";
  if (provider === "alipay_manual") return "支付宝（人工核实）";
  if (provider === "balance") return "账户余额";
  const network = networkForProvider(provider);
  return network ? USDT_NETWORKS[network].label : "人工到账";
}

export const metadata: Metadata = { title: "订单详情", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ShopOrderPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const user = await getCurrentUser();
  const { orderNo } = await params;
  if (!user) redirect(`/login?next=/shop/orders/${orderNo}`);

  const order = await findShopOrderByNo(orderNo, user.id);
  if (!order) notFound();

  const orderTickets = await listTicketsForOrder(user.id, order.id);
  const activeTicket = orderTickets.find((ticket) => ticket.status === "open") ?? null;
  const supportHref = activeTicket
    ? `/dashboard/support/${activeTicket.id}`
    : `/dashboard/support?orderId=${order.id}`;

  const delivered = order.procurement_status === "delivered";
  const input = decryptCustomerInput(order.customer_input_encrypted);
  const inputRows = Object.entries(input);
  // 客户视角的进度日志：白名单过滤，运营备注与内部字段不会出现在这里。
  const progress = await loadCustomerOrderEvents(order.id);

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main shop-page">
        <div className="container shop-order-page">
          <Link className="shop-back" href="/dashboard/shop">
            <ArrowLeft size={14} /> 我的订单
          </Link>

          <div className="shop-order-head">
            <div>
              <span className="eyebrow">订单 {order.order_no}</span>
              <h1>{order.product_name}</h1>
              <p>
                {new Date(order.created_at).toLocaleString("zh-CN")} 下单 ·{" "}
                {formatCny(order.amount_micros)}
              </p>
            </div>
            <span className={`shop-status shop-status-${order.status}`}>
              {SHOP_COPY.orderStatus[order.status]}
            </span>
          </div>

          <OrderTimeline status={order.status} />

          <div className="shop-order-grid">
            <section className="shop-panel">
              <h2>交付内容</h2>
              {delivered ? (
                <DeliveryReveal orderId={order.id} delivered />
              ) : (
                <div className="shop-delivery-pending">
                  <span>
                    {order.status === "pending_payment"
                      ? "等待支付"
                      : order.status === "expired"
                        ? "订单已过期"
                        : order.status === "cancelled"
                          ? "订单已取消"
                          : order.status === "refund_pending" || order.status === "refunded"
                            ? "正在处理退款"
                            : "正在采购 / 处理中"}
                  </span>
                  {order.status === "expired" || order.status === "cancelled" ? (
                    <>
                      <small>
                        这个订单不会再处理了。如果已经付过款，请联系客服并提供订单号。
                      </small>
                      <Link className="btn btn-primary" href="/shop">
                        重新选购
                      </Link>
                    </>
                  ) : (
                    <>
                      <small>完成后可在本页领取交付内容，页面会自动更新。</small>
                      <AutoRefresh seconds={25} />
                    </>
                  )}
                </div>
              )}

              {progress.length > 0 ? (
                <section className="shop-progress" aria-labelledby="shop-progress-title">
                  <h2 id="shop-progress-title">订单进度</h2>
                  <ol>
                    {progress.map((event, index) => (
                      <li
                        key={`${event.key}-${index}`}
                        className={event.key === "payment_claim_rejected" || event.key === "alipay_unreported" || event.key === "out_of_stock" ? "is-warn" : ""}
                      >
                        <i />
                        <div>
                          <strong>{event.label}</strong>
                          <p>{event.detail}</p>
                          <time dateTime={event.created_at}>
                            {new Date(event.created_at).toLocaleString("zh-CN")}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {order.status === "refund_pending" ? (
                <div className="shop-refund-notice">
                  <strong>退款协商中</strong>
                  <p>
                    请在客服会话中发送你的支付宝收款码（需与实名一致）和收款姓名。运营核对订单与金额后按协商结果退款，
                    退款后可退款金额为 {formatCny(order.amount_micros)}，完成前请不要重复申请。
                  </p>
                  <Link className="text-link" href={supportHref}>
                    {activeTicket ? "打开站内售后工单" : "提交站内售后工单"}
                  </Link>
                </div>
              ) : null}

              {order.delivery_note ? (
                <p className="shop-order-note">{order.delivery_note}</p>
              ) : null}

              {inputRows.length > 0 ? (
                <details className="shop-order-inputs">
                  <summary>已提交的信息</summary>
                  <dl className="shop-summary">
                    {inputRows.map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>
                          {key.includes("password") || key.includes("密码")
                            ? "••••••••"
                            : `${value.slice(0, 2)}***${value.slice(-2)}`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="shop-muted">
                    账号信息加密保存，交付完成 {config.shopCustomerInputRetentionDays} 天后自动清除。
                  </p>
                </details>
              ) : null}
            </section>

            <aside className="shop-panel">
              <h2>订单信息</h2>
              <dl className="shop-summary">
                <div>
                  <dt>订单号</dt>
                  <dd>{order.order_no}</dd>
                </div>
                <div>
                  <dt>支付方式</dt>
                  <dd>
                    {paymentLabel(order.payment_provider)}
                  </dd>
                </div>
                <div>
                  <dt>金额</dt>
                  <dd>{formatCny(order.amount_micros)}</dd>
                </div>
                {order.pay_txid ? (
                  <div>
                    <dt>交易哈希</dt>
                    <dd className="mono shop-break">{order.pay_txid}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>付款时间</dt>
                  <dd>{order.paid_at ? new Date(order.paid_at).toLocaleString("zh-CN") : "—"}</dd>
                </div>
                <div>
                  <dt>完成时间</dt>
                  <dd>
                    {order.delivered_at ? new Date(order.delivered_at).toLocaleString("zh-CN") : "—"}
                  </dd>
                </div>
              </dl>

              {order.status === "pending_payment" ? (
                <Link className="btn btn-primary btn-block" href={`/shop/checkout/${order.order_no}`}>
                  去支付
                </Link>
              ) : null}

              <Link className="btn btn-light btn-block" href={supportHref}>
                <Headset size={15} />
                {activeTicket
                  ? activeTicket.unreadCount > 0
                    ? `售后工单有新回复（${activeTicket.unreadCount}）`
                    : "查看售后工单"
                  : "联系售后（站内工单）"}
              </Link>
              {orderTickets.length > 0 && !activeTicket ? (
                <Link
                  className="text-link shop-order-support-history"
                  href={`/dashboard/support/${orderTickets[0].id}`}
                >
                  查看历史工单
                </Link>
              ) : null}
              <p className="shop-muted shop-order-support-note">
                工单会关联本订单，运营在站内回复，回复后在「售后工单」里可查看。
              </p>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
