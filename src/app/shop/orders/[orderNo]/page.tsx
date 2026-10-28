import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Envelope } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { DeliveryReveal } from "@/components/shop/DeliveryReveal";
import { OrderTimeline } from "@/components/shop/OrderTimeline";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { formatCny } from "@/lib/money";
import { decryptCustomerInput, findShopOrderByNo } from "@/lib/shop/orders";
import { SHOP_COPY } from "@/lib/shop/copy";

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

  const delivered = order.procurement_status === "delivered";
  const input = decryptCustomerInput(order.customer_input_encrypted);
  const inputRows = Object.entries(input);

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
                      : order.status === "refund_pending" || order.status === "refunded"
                        ? "正在处理退款"
                        : "正在采购 / 处理中"}
                  </span>
                  <small>完成后可在本页领取交付内容，页面会自动更新。</small>
                </div>
              )}

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
                    {order.payment_provider === "alipay_easypay"
                      ? "支付宝"
                      : order.payment_provider === "usdt_trc20"
                        ? "USDT TRC20"
                        : "人工到账"}
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

              <a className="btn btn-light btn-block" href={`mailto:${config.shopSupportEmail}`}>
                <Envelope size={15} /> 联系售后
              </a>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
