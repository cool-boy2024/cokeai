import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, PackageCheck } from "lucide-react";
import {
  adminDeliverShopAction,
  adminMarkShopPaidAction,
  adminOutOfStockShopAction,
  adminRefundShopAction,
  adminStartProcurementAction,
} from "@/app/actions/admin-shop";
import { DeliveryFields } from "@/components/admin-shop/DeliveryFields";
import { ProcurementCopy } from "@/components/admin-shop/ProcurementCopy";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { offerAvailabilityLabel, SHOP_COPY } from "@/lib/shop/copy";
import { decryptCustomerInput, getAdminShopOrder } from "@/lib/shop/orders";

export const metadata: Metadata = { title: "小店订单详情" };
export const dynamic = "force-dynamic";

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  alipay_manual: "支付宝（人工核实）",
  alipay_easypay: "支付宝（易支付）",
  usdt_trc20: "USDT TRC20",
  usdt_bsc: "USDT BSC",
  usdt_polygon: "USDT Polygon",
  manual: "人工确认",
};

export default async function AdminShopOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const flags = await searchParams;
  const order = await getAdminShopOrder(id);
  if (!order) notFound();

  const offer = order.supplier_offer_id
    ? (
        await query<{
          url: string;
          source_title: string;
          source_store: string;
          price_micros: string;
          availability: string;
        }>(
          `SELECT url, source_title, source_store, price_micros, availability
             FROM shop_offers WHERE id = $1 LIMIT 1`,
          [order.supplier_offer_id],
        )
      ).rows[0]
    : null;
  const customerInput = decryptCustomerInput(order.customer_input_encrypted);
  const manualClaim =
    order.payment_provider === "alipay_manual"
      ? (
          await query<{
            reported_reference: string | null;
            payer_note: string | null;
            reported_at: string | Date | null;
          }>(
            `SELECT reported_reference, payer_note, reported_at
               FROM manual_alipay_payments
              WHERE order_id = $1 AND order_kind = 'shop'
              LIMIT 1`,
            [order.id],
          )
        ).rows[0] ?? null
      : null;
  const canProcure = order.status === "paid" || order.status === "procuring";
  const canPay = order.status === "pending_payment" && ["manual", "alipay_manual"].includes(order.payment_provider);
  const procurementText = [
    "[CokeAI 采购单]",
    `订单：${order.order_no}`,
    `商品：${order.product_name}`,
    `数量：${order.qty}`,
    `售价：${formatCny(order.amount_micros)}`,
    offer ? `供货商：${offer.source_store}` : "",
    offer ? `供货商链接：${offer.url}` : "",
    offer ? `原始标题：${offer.source_title}` : "",
    Object.keys(customerInput).length > 0 ? "客户填写：" : "",
    ...Object.entries(customerInput).map(([key, value]) => `- ${key}: ${value}`),
    order.customer_note ? `客户备注：${order.customer_note}` : "",
    "下单后请回填供货商订单号，再上传交付内容。",
  ]
    .filter(Boolean)
    .join("\n");

  const paymentProviderLabel =
    PAYMENT_PROVIDER_LABELS[order.payment_provider] || order.payment_provider;
  const supplierCost = order.supplier_offer_id
    ? formatCny(order.supplier_cost_micros)
    : "未绑定货源";
  const deliveryDefaultKind: "code" | "account" | "manual_note" = ["code", "account", "manual_note"].includes(
    String(order.delivery_kind),
  )
    ? (order.delivery_kind as "code" | "account" | "manual_note")
    : "code";

  return (
    <>
      <Link className="shop-back" href="/admin/shop/orders">
        <ArrowLeft size={14} /> 小店订单
      </Link>

      <div className="page-head">
        <div>
          <h1>{order.order_no}</h1>
          <p>
            {order.product_name} · {formatDateTime(order.created_at)} · {formatCny(order.amount_micros)}
          </p>
        </div>
        <span className={`shop-status shop-status-${order.status}`}>
          {SHOP_COPY.orderStatus[order.status]}
        </span>
      </div>

      {flags.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>操作已完成。</div>
        </div>
      ) : null}
      {flags.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{flags.error}</div>
        </div>
      ) : null}

      <div className="shop-admin-detail">
        <div className="shop-admin-main">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>订单信息</h2>
                <p>下单时间 {formatDateTime(order.created_at)}</p>
              </div>
              <span className="badge">{paymentProviderLabel}</span>
            </div>
            <div className="panel-body">
              <dl className="shop-summary">
                <div>
                  <dt>客户</dt>
                  <dd>
                    {order.email || "—"}
                    {order.name ? `（${order.name}）` : ""}
                  </dd>
                </div>
                <div>
                  <dt>商品 / 数量</dt>
                  <dd>
                    {order.product_name} × {order.qty}
                  </dd>
                </div>
                <div>
                  <dt>售价 / 成本</dt>
                  <dd>
                    {formatCny(order.amount_micros)} / {supplierCost}
                  </dd>
                </div>
                <div>
                  <dt>支付时间</dt>
                  <dd>{order.paid_at ? formatDateTime(order.paid_at) : "—"}</dd>
                </div>
                <div>
                  <dt>交付时间</dt>
                  <dd>{order.delivered_at ? formatDateTime(order.delivered_at) : "—"}</dd>
                </div>
                <div>
                  <dt>客户备注</dt>
                  <dd>{order.customer_note || "—"}</dd>
                </div>
                <div>
                  <dt>运营备注</dt>
                  <dd>{order.admin_note || "—"}</dd>
                </div>
                {order.pay_txid ? (
                  <div>
                    <dt>交易哈希</dt>
                    <dd className="mono shop-break">{order.pay_txid}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </section>

          <section className="panel" id="procurement">
            <div className="panel-head">
              <div>
                <h2>采购</h2>
                <p>去供货商下单后回填单号，再上传交付内容</p>
              </div>
              <div className="shop-panel-actions">
                <ProcurementCopy text={procurementText} />
                {offer ? (
                  <a className="btn btn-light btn-sm" href={offer.url} target="_blank" rel="noreferrer">
                    去供货商下单 <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            </div>
            <div className="panel-body shop-panel-stack">
              {offer ? (
                <>
                  <div className="shop-procure-pack">
                    <span>供货商</span>
                    <strong>{offer.source_store}</strong>
                    <span>原始标题（内部）</span>
                    <code>{offer.source_title}</code>
                    <span>成本 / 库存</span>
                    <strong>
                      {formatCny(offer.price_micros)} · {offerAvailabilityLabel(offer.availability)}
                    </strong>
                    <span>采购数量</span>
                    <strong>{order.qty}</strong>
                  </div>
                  <p className="shop-muted">
                    采购链接和原始标题只出现在后台。公开页面只显示 CokeAI 商品文案。
                  </p>
                </>
              ) : (
                <div className="shop-empty-inline">未绑定供货商 offer。请在商品货源中绑定后再采购。</div>
              )}

              {canProcure ? (
                <form action={adminStartProcurementAction} className="shop-admin-form">
                  <input type="hidden" name="orderId" value={order.id} />
                  <div className="shop-form-grid">
                    <label className="shop-field">
                      <span>供货商订单号（选填）</span>
                      <input name="supplierOrderRef" placeholder="下单后回填" maxLength={200} />
                    </label>
                    <label className="shop-field">
                      <span>备注</span>
                      <input name="note" placeholder="例如：已用支付宝付款" maxLength={500} />
                    </label>
                  </div>
                  <button className="btn btn-dark btn-block" type="submit">
                    <PackageCheck size={14} /> 标记已采购
                  </button>
                </form>
              ) : null}
            </div>
          </section>

          {customerInput && Object.keys(customerInput).length > 0 ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>客户填写</h2>
                  <p>仅用于本次采购，交付完成 7 天后自动清除</p>
                </div>
                <span className="badge badge-yellow">加密存储</span>
              </div>
              <div className="panel-body">
                <dl className="shop-summary">
                  {Object.entries(customerInput).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd className="mono shop-break">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>订单日志</h2>
              </div>
              <span className="badge">{(order.events || []).length} 条</span>
            </div>
            <div className="panel-body">
              <ul className="shop-event-list">
                {(order.events || []).map((event) => (
                  <li key={event.id}>
                    <span className="shop-event-dot" />
                    <div>
                      <strong>{event.event}</strong>
                      <p>{event.note || "—"}</p>
                      <small>
                        {event.actor_type} · {formatDateTime(event.created_at)}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <aside className="shop-admin-side">
          {canPay ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>确认到账</h2>
                  <p>仅用于人工到账或已核实的线下付款</p>
                </div>
              </div>
              <div className="panel-body">
                {order.payment_provider === "alipay_manual" ? (
                  manualClaim?.reported_at ? (
                    <div className="notice notice-yellow">
                      <div>
                        <strong>客户已上报付款</strong>
                        <p>交易号：{manualClaim.reported_reference || "未填写"}</p>
                        {manualClaim.payer_note ? <p>客户备注：{manualClaim.payer_note}</p> : null}
                        <p>上报时间：{formatDateTime(manualClaim.reported_at)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="shop-muted">客户尚未上报交易号，请以支付宝账单实际到账为准。</p>
                  )
                ) : null}
                <form action={adminMarkShopPaidAction} className="shop-admin-form">
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="orderNo" value={order.order_no} />
                  <label className="shop-field">
                    <span>收款账单中的完整交易号</span>
                    <input
                      name="receiptRef"
                      defaultValue={manualClaim?.reported_reference || ""}
                      minLength={8}
                      maxLength={80}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className="shop-field">
                    <span>实际到账金额（元）</span>
                    <input
                      name="amountYuan"
                      defaultValue={(Number(order.amount_micros) / 1_000_000).toFixed(2)}
                      inputMode="decimal"
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className="payment-check">
                    <input type="checkbox" name="checked" required />
                    我已在自己的收款账单核实实际到账及订单归属
                  </label>
                  <label className="shop-field">
                    <span>备注</span>
                    <input name="note" placeholder="付款凭证 / 说明" maxLength={500} />
                  </label>
                  <button className="btn btn-primary btn-block" type="submit">
                    确认到账
                  </button>
                </form>
              </div>
            </section>
          ) : null}

          {canProcure ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>上传交付</h2>
                  <p>交付后客户可在订单页领取</p>
                </div>
              </div>
              <div className="panel-body">
                <form action={adminDeliverShopAction} className="shop-admin-form">
                  <input type="hidden" name="orderId" value={order.id} />
                  <DeliveryFields defaultKind={deliveryDefaultKind} />
                  <label className="shop-field">
                    <span>交付备注（客户可见）</span>
                    <input name="note" maxLength={1000} placeholder="客户在订单页可以看到" />
                  </label>
                  <button className="btn btn-primary btn-block" type="submit">
                    标记已交付
                  </button>
                </form>
              </div>
            </section>
          ) : null}

          {canProcure ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>缺货 / 退款</h2>
                  <p>异常处理，操作前请先与客户确认</p>
                </div>
              </div>
              <div className="panel-body shop-panel-stack">
                <form action={adminOutOfStockShopAction} className="shop-admin-form shop-form-section">
                  <input type="hidden" name="orderId" value={order.id} />
                  <h3>供货商缺货</h3>
                  <label className="shop-field">
                    <span>缺货原因（内部）</span>
                    <input name="reason" placeholder="供货商缺货" maxLength={500} />
                  </label>
                  <button className="btn btn-danger btn-block" type="submit">
                    标记缺货并转退款
                  </button>
                </form>
                <form action={adminRefundShopAction} className="shop-admin-form shop-form-section">
                  <input type="hidden" name="orderId" value={order.id} />
                  <h3>直接退款</h3>
                  <div className="shop-form-grid">
                    <label className="shop-field">
                      <span>退款金额（元）</span>
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={(order.amount_micros / 1_000_000).toFixed(2)}
                      />
                    </label>
                    <label className="shop-field">
                      <span>退款单号 / 交易哈希</span>
                      <input name="providerRef" maxLength={500} />
                    </label>
                  </div>
                  <label className="shop-field">
                    <span>退款原因</span>
                    <input name="reason" maxLength={500} />
                  </label>
                  <button className="btn btn-light btn-block" type="submit">
                    标记已退款
                  </button>
                </form>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
