import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import {
  Warning,
  Clock,
  Copy,
  Headset,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { CopyButton } from "@/components/CopyButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AutoRefresh } from "@/components/shop/AutoRefresh";
import { OrderTimeline } from "@/components/shop/OrderTimeline";
import { ShopUsdtCountdown } from "@/components/shop/UsdtCountdown";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { USDT_NETWORKS, networkForProvider } from "@/lib/payments/networks";
import { USDT_FEE_NOTICE } from "@/lib/payments/usdt-copy";
import { formatCny } from "@/lib/money";
import { findShopOrderByNo } from "@/lib/shop/orders";
import { loadPaymentImages } from "@/lib/shop/payment-images";
import { createShopEasyPayCheckout } from "@/lib/shop/payments";
import {
  expireShopUsdtOrderForUser,
  getShopUsdtDeposit,
} from "@/lib/shop/usdt";
import { query } from "@/lib/db";
import { ManualPaymentClaimForm } from "@/components/ManualPaymentClaimForm";
import { retryShopBalancePaymentAction } from "@/app/actions/shop";

const BALANCE_PAYMENT_MESSAGES: Record<string, string> = {
  insufficient: "账户余额不足，订单仍保留为待支付。充值后可重新尝试余额支付。",
  processing: "余额支付处理中，请勿重复付款。页面会自动刷新。",
  failed: "余额支付未完成，订单仍保留为待支付；可以重新尝试。",
  closed: "订单已关闭，无法使用余额支付。",
  reversal_failed: "余额扣款需要人工核对，请勿重复付款，并联系客服处理。",
  rate: "操作过于频繁，请稍后再试。",
};

export const metadata: Metadata = { title: "订单支付", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ShopCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const { orderNo } = await params;
  const queryParams = await searchParams;
  const balanceCode = Array.isArray(queryParams.balance)
    ? queryParams.balance[0]
    : queryParams.balance;
  if (!user) redirect(`/login?next=/shop/checkout/${orderNo}`);

  const order = await findShopOrderByNo(orderNo, user.id);
  if (!order) notFound();
  if (order.status !== "pending_payment") redirect(`/shop/orders/${orderNo}`);
  // A closed order must not show a payable address or QR for ANY channel. Only
  // the USDT path used to check expiry, so a buyer could still pay the EasyPay
  // link or the manual Alipay QR after the order had expired — money out, order
  // closed. Send them to the order page, which explains the state.
  if (new Date(order.expires_at).getTime() <= Date.now()) {
    redirect(`/shop/orders/${orderNo}`);
  }
  const personal = order.payment_provider === "alipay_manual" ? (await query<{ qr_data_url: string; payee: string; reported_reference: string | null; payer_note: string | null; reported_at: string | null }>("SELECT qr_data_url,payee,reported_reference,payer_note,reported_at FROM manual_alipay_payments WHERE order_id=$1 AND order_kind='shop'", [order.id])).rows[0] : null;
  // 客户已经传过的付款截图，刷新后还能看到。
  const paymentScreenshots = personal ? await loadPaymentImages(order.id) : [];
  // An admin can send a claim back; while no new claim is reported, show why.
  const rejectedClaim =
    personal && !personal.reported_at
      ? (await query<{ note: string; created_at: Date }>(
          `SELECT note, created_at FROM shop_order_events
            WHERE order_id = $1 AND event = 'payment_claim_rejected'
            ORDER BY created_at DESC LIMIT 1`,
          [order.id],
        )).rows[0]
      : null;

  const usdtNetwork = networkForProvider(order.payment_provider);
  const usdtMeta = usdtNetwork ? USDT_NETWORKS[usdtNetwork] : null;
  let usdtDeposit = usdtNetwork ? await getShopUsdtDeposit(order.id) : null;
  if (
    usdtDeposit &&
    usdtNetwork &&
    new Date(usdtDeposit.expires_at).getTime() <= Date.now()
  ) {
    const expired = await expireShopUsdtOrderForUser(order.id, user.id);
    if (expired) redirect(`/shop/orders/${orderNo}`);
    usdtDeposit = await getShopUsdtDeposit(order.id);
  }
  const usdtAddress = usdtNetwork
    ? usdtDeposit?.address || order.pay_address || ""
    : "";
  const usdtQr = usdtAddress
    ? await QRCode.toDataURL(usdtAddress, { margin: 1, width: 260 })
    : "";
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
                    {order.payment_provider === "alipay_easypay"
                      ? "支付宝（易支付）"
                      : order.payment_provider === "alipay_manual"
                        ? "支付宝（人工核实）"
                        : order.payment_provider === "balance"
                          ? "账户余额"
                          : usdtMeta
                            ? usdtMeta.label
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
              {order.payment_provider === "balance" ? (
                <div className="payment-form">
                  <h2>账户余额支付</h2>
                  <p>
                    应付 <strong>{formatCny(order.amount_micros)}</strong>
                    ，从 CokeAI 账户余额中扣除。
                  </p>
                  <div className="notice">
                    <ShieldCheck size={16} />
                    <div>
                      {BALANCE_PAYMENT_MESSAGES[balanceCode || ""] ||
                        "余额支付尚未完成。订单仍为待支付，重新尝试不会重复扣款。"}
                    </div>
                  </div>
                  <form action={retryShopBalancePaymentAction}>
                    <input type="hidden" name="orderNo" value={order.order_no} />
                    <button className="btn btn-primary btn-block" type="submit">
                      重新尝试余额支付
                    </button>
                  </form>
                  <a className="btn btn-light btn-block" href="/dashboard/billing">
                    去充值
                  </a>
                  <p className="shop-muted">
                    <Clock size={14} /> 如果刚刚已经扣款，请先刷新订单页；
                    系统按订单号幂等处理，不会重复扣款。
                  </p>
                  <AutoRefresh seconds={20} />
                </div>
              ) : null}
              {personal ? <div className="payment-form">
                <h2>支付宝扫码付款</h2>
                <p>应付 <strong>{formatCny(order.amount_micros)}</strong> · 收款人：{personal.payee}</p>
                {rejectedClaim ? (
                  <div className="notice notice-red">
                    <Warning size={16} />
                    <div>
                      <strong>付款信息已被打回</strong>
                      <p>原因：{rejectedClaim.note}</p>
                      <p>
                        请先在支付宝账单核对交易号、金额和订单号，再重新提交。同一笔转账不能用于多张订单，请不要重复付款。
                      </p>
                    </div>
                  </div>
                ) : null}
                {personal.reported_at ? <div className="notice">已提交付款信息，等待核实。请勿重复付款。</div> : null}
                <img className="payment-qr" src={personal.qr_data_url} alt="支付宝收款二维码" />
                {/* 备注里的订单号是唯一能 100% 精确对账的线索，所以不再写成一行灰字。 */}
                <div className="notice notice-yellow">
                  <Warning size={16} />
                  <div>
                    <strong>付款时请在备注里填订单号</strong>
                    <div className="shop-copy-line">
                      <code>{order.order_no}</code>
                      <CopyButton value={order.order_no} label="复制订单号" className="copy-btn shop-copy-btn" />
                    </div>
                    <p>
                      备注填了订单号，核对是自动的、发货最快；不填就只能等人工按金额和时间比对，会慢一些。
                      请核对收款人和应付金额 {formatCny(order.amount_micros)}。
                    </p>
                  </div>
                </div>
                <ManualPaymentClaimForm orderId={order.id} orderKind="shop" reference={personal.reported_reference || ""} note={personal.payer_note || ""} />
                {paymentScreenshots.length > 0 ? (
                  <div className="shop-copy-row">
                    <span>已上传的付款截图</span>
                    <div className="flex flex-wrap gap-8">
                      {paymentScreenshots.map((image) => (
                        <a
                          key={image.hash}
                          href={`/api/support/images/${image.hash}.${image.ext}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/support/images/${image.hash}.${image.ext}`}
                            alt="付款截图"
                            style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 8 }}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                <AutoRefresh seconds={30} />
              </div> : null}
              {order.payment_provider === "alipay_manual" && !personal ? (
                <div className="notice notice-red">
                  <Warning size={16} />
                  <div>
                    收款信息读取失败，请返回重新下单或
                    <Link href={`/dashboard/support?orderId=${order.id}`}>提交站内工单</Link>
                    处理。
                  </div>
                </div>
              ) : null}
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

              {usdtMeta ? (
                <>
                  <h2>{usdtMeta.label}</h2>
                  {usdtDeposit ? (
                    <>
                      <div className="shop-usdt-qr-wrap">
                        {usdtQr ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="payment-qr shop-usdt-qr"
                            src={usdtQr}
                            alt={`${usdtMeta.label} 收款二维码`}
                            width={260}
                            height={260}
                          />
                        ) : null}
                        <span>扫码后核对地址，金额请手动输入</span>
                      </div>
                      <div className="shop-usdt-amount">
                        <span>应付金额</span>
                        <strong>
                          {Number(usdtDeposit.expected_usdt).toFixed(2)} <small>USDT</small>
                        </strong>
                        <em>请使用 {usdtMeta.chainLabel} 网络，到账金额不能少于应付金额</em>
                      </div>
                      <div className="notice notice-yellow">
                        <Warning size={16} />
                        <div>
                          <strong>{USDT_FEE_NOTICE.title}</strong>
                          {USDT_FEE_NOTICE.lines.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </div>
                      </div>
                      <ShopUsdtCountdown
                        orderId={order.id}
                        expiresAt={usdtDeposit.expires_at}
                      />
                      <div className="shop-copy-row">
                        <span>收款地址</span>
                        <div className="shop-copy-line">
                          <code>{usdtDeposit.address}</code>
                          <CopyButton
                            value={usdtDeposit.address}
                            label="复制地址"
                            className="copy-btn shop-copy-btn"
                          />
                        </div>
                      </div>
                      <div className="shop-summary shop-summary-tight">
                        <div>
                          <dt>已到账</dt>
                          <dd>{Number(usdtDeposit.received_usdt).toFixed(2)} USDT</dd>
                        </div>
                        <div>
                          <dt>确认数</dt>
                          <dd>{usdtDeposit.confirmations} / {usdtMeta.requiredConfirmations}</dd>
                        </div>
                        <div>
                          <dt>支付截止</dt>
                          <dd>{new Date(usdtDeposit.expires_at).toLocaleString("zh-CN")}</dd>
                        </div>
                      </div>
                      <p className="shop-muted">
                        <ShieldCheck size={14} /> {usdtMeta.transferHint} 请在{" "}
                        {config.usdtQuoteMinutes} 分钟内完成，超时未到账会自动取消；
                        地址必须完全一致，到账金额不能少于应付金额，等待{" "}
                        {usdtMeta.requiredConfirmations} 个区块确认后自动完成。
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
                  <Link
                    className="btn btn-light btn-block"
                    href={`/dashboard/support?orderId=${order.id}`}
                  >
                    <Headset size={15} /> 联系客服（站内工单）
                  </Link>
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
