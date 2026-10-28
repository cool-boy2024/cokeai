import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Warning,
  Clock,
  Copy,
  Envelope,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AutoRefresh } from "@/components/shop/AutoRefresh";
import { OrderTimeline } from "@/components/shop/OrderTimeline";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { formatCny } from "@/lib/money";
import { findShopOrderByNo } from "@/lib/shop/orders";
import { createShopEasyPayCheckout } from "@/lib/shop/payments";
import { getShopUsdtDeposit } from "@/lib/shop/usdt";
import { query } from "@/lib/db";
import { ManualPaymentClaimForm } from "@/components/ManualPaymentClaimForm";

export const metadata: Metadata = { title: "订单支付", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ShopCheckoutPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const user = await getCurrentUser();
  const { orderNo } = await params;
  if (!user) redirect(`/login?next=/shop/checkout/${orderNo}`);

  const order = await findShopOrderByNo(orderNo, user.id);
  if (!order) notFound();
  if (order.status !== "pending_payment") redirect(`/shop/orders/${orderNo}`);
  const personal = order.payment_provider === "alipay_manual" ? (await query<{ qr_data_url: string; payee: string; reported_reference: string | null; payer_note: string | null; reported_at: string | null }>("SELECT qr_data_url,payee,reported_reference,payer_note,reported_at FROM manual_alipay_payments WHERE order_id=$1 AND order_kind='shop'", [order.id])).rows[0] : null;

  const usdtDeposit =
    order.payment_provider === "usdt_trc20" ? await getShopUsdtDeposit(order.id) : null;
  const alipayUrl =
    order.payment_provider === "alipay_easypay"
      ? createShopEasyPayCheckout({
          orderNo: order.order_no,
          amountMicros: order.amount_micros,
          productName: order.product_name,
        }).url
      : null;

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main shop-page">
        <div className="container shop-checkout">
          <div className="shop-checkout-head">
            <span className="eyebrow">安全支付</span>
            <h1>完成支付</h1>
            <p>订单号 {order.order_no}</p>
          </div>

          <OrderTimeline status={order.status} />

          <div className="shop-checkout-grid">
            <section className="shop-panel">
              <div className="shop-panel-head">
                <h2>{order.product_name}</h2>
                <strong>{formatCny(order.amount_micros)}</strong>
              </div>
              <dl className="shop-summary">
                <div>
                  <dt>数量</dt>
                  <dd>{order.qty}</dd>
                </div>
                <div>
                  <dt>支付方式</dt>
                  <dd>
                    {["alipay_easypay", "alipay_manual"].includes(order.payment_provider)
                      ? "支付宝"
                      : order.payment_provider === "usdt_trc20"
                        ? "USDT TRC20"
                        : "人工到账"}
                  </dd>
                </div>
                <div>
                  <dt>下单时间</dt>
                  <dd>{new Date(order.created_at).toLocaleString("zh-CN")}</dd>
                </div>
                <div>
                  <dt>支付截止</dt>
                  <dd>{new Date(order.expires_at).toLocaleString("zh-CN")}</dd>
                </div>
              </dl>
            </section>

            <section className="shop-panel shop-pay-panel">
              {personal ? <div className="payment-form">
                <h2>支付宝支付</h2>
                <p>应付 <strong>{formatCny(order.amount_micros)}</strong> · 收款人：{personal.payee}</p>
                {personal.reported_at ? <div className="notice">已提交付款信息，等待核实。请勿重复付款。</div> : null}
                <img className="payment-qr" src={personal.qr_data_url} alt="支付宝收款二维码" />
                <p className="small muted">请核对收款人和金额。付款备注填写订单号 {order.order_no}，到账核实后安排交付。</p>
                <ManualPaymentClaimForm orderId={order.id} orderKind="shop" reference={personal.reported_reference || ""} note={personal.payer_note || ""} />
              </div> : null}
              {order.payment_provider === "alipay_easypay" ? (
                <>
                  <h2>支付宝支付</h2>
                  <p>如果收银台没有自动打开，点击下面的按钮继续支付。</p>
                  {alipayUrl ? (
                    <a className="btn btn-primary btn-block" href={alipayUrl}>
                      打开支付宝收银台
                    </a>
                  ) : (
                    <div className="notice notice-red">
                      <Warning size={16} />
                      <div>支付宝暂不可用，请联系客服。</div>
                    </div>
                  )}
                  <p className="shop-muted">
                    <Clock size={14} /> 支付完成后本页会自动更新，通常几秒内到账。
                  </p>
                  <AutoRefresh />
                </>
              ) : null}

              {order.payment_provider === "usdt_trc20" ? (
                <>
                  <h2>USDT TRC20</h2>
                  {usdtDeposit ? (
                    <>
                      <div className="shop-usdt-amount">
                        <span>应付金额</span>
                        <strong>
                          {Number(usdtDeposit.expected_usdt).toFixed(2)} <small>USDT</small>
                        </strong>
                        <em>请使用 TRC20 网络，金额必须一致</em>
                      </div>
                      <div className="shop-copy-row">
                        <span>收款地址</span>
                        <code>{usdtDeposit.address}</code>
                      </div>
                      <div className="shop-summary shop-summary-tight">
                        <div>
                          <dt>已到账</dt>
                          <dd>{Number(usdtDeposit.received_usdt).toFixed(2)} USDT</dd>
                        </div>
                        <div>
                          <dt>确认数</dt>
                          <dd>{usdtDeposit.confirmations} / {config.usdtConfirmations}</dd>
                        </div>
                        <div>
                          <dt>报价有效期</dt>
                          <dd>{new Date(usdtDeposit.expires_at).toLocaleString("zh-CN")}</dd>
                        </div>
                      </div>
                      <p className="shop-muted">
                        <ShieldCheck size={14} /> 只支持 TRC20。转账金额与地址必须完全一致，
                        等待 {config.usdtConfirmations} 个区块确认后自动完成。
                      </p>
                    </>
                  ) : (
                    <div className="notice notice-red">
                      <Warning size={16} />
                      <div>USDT 收款地址尚未生成，请返回重新下单或联系客服。</div>
                    </div>
                  )}
                  <AutoRefresh seconds={20} />
                </>
              ) : null}

              {order.payment_provider === "manual" ? (
                <>
                  <h2>人工到账</h2>
                  <p>请联系客服获取收款方式，转账 {formatCny(order.amount_micros)} 时在备注中填写订单号。</p>
                  <div className="shop-copy-row">
                    <span>订单号</span>
                    <code>{order.order_no}</code>
                  </div>
                  <p className="shop-muted">
                    <Copy size={14} /> 付款后联系客服确认，客服核对账单后会在后台标记到账。
                  </p>
                  <a className="btn btn-light btn-block" href={`mailto:${config.shopSupportEmail}`}>
                    <Envelope size={15} /> 联系客服
                  </a>
                  <AutoRefresh seconds={30} />
                </>
              ) : null}
            </section>
          </div>

          <div className="shop-checkout-foot">
            <Link href="/shop">继续逛小店</Link>
            <Link href="/dashboard/shop">我的订单</Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
