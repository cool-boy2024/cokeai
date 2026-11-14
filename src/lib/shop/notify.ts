import { config } from "@/lib/config";
import { sendAlert } from "@/lib/alerts";
import { query, toNumber } from "@/lib/db";
import { formatCny } from "@/lib/money";
import { USDT_NETWORKS, type UsdtNetwork } from "@/lib/payments/networks";
import { preorderSql } from "@/lib/shop/preorder";

const PROVIDER_LABELS: Record<string, string> = {
  alipay_easypay: "支付宝",
  alipay_manual: "支付宝（人工收款）",
  usdt_trc20: "USDT TRC20",
  usdt_bsc: "USDT BEP20（BSC）",
  usdt_polygon: "USDT Polygon",
  manual: "人工确认",
};

/**
 * Tells the operators the moment a customer places an order, before payment.
 * The partner should not have to watch the console to know demand arrived.
 *
 * The caller should not await this: a slow channel must never block checkout,
 * and an unconfigured channel is not an error.
 */
export async function notifyShopOrderCreated(
  orderId: string,
  contactEmail?: string,
): Promise<void> {
  try {
    const result = await query<{
      order_no: string;
      amount_micros: string | number;
      payment_provider: string;
      product_name: string;
      qty: number;
      email: string;
      has_customer_input: boolean;
      preorder: boolean;
      created_at: Date;
    }>(
      `SELECT o.order_no, o.amount_micros, o.payment_provider, o.created_at,
              i.product_name, i.qty, u.email,
              (i.customer_input_encrypted IS NOT NULL) AS has_customer_input,
              COALESCE(${preorderSql("p.")}, FALSE) AS preorder
         FROM shop_orders o
         JOIN shop_order_items i ON i.order_id = o.id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN shop_products p ON p.id = i.product_id
        WHERE o.id = $1
        LIMIT 1`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return;

    const text = [
      "【CokeAI 小店】客户已下单（待付款）",
      `订单号：${row.order_no}`,
      `商品：${row.product_name} × ${Number(row.qty)}`,
      row.preorder ? "类型：预定单（按预定顺序采购，可能延迟发货）" : "类型：现货/常规商品",
      `金额：${formatCny(toNumber(row.amount_micros))}`,
      `客户账号：${row.email}`,
      contactEmail ? `联系邮箱：${contactEmail}` : null,
      `渠道：${PROVIDER_LABELS[row.payment_provider] || row.payment_provider}`,
      `下单时间：${new Date(row.created_at).toLocaleString("zh-CN")}`,
      row.has_customer_input ? "客户已填写交付所需信息（后台可查看）。" : null,
      `后台：${config.appUrl}/admin/shop/orders/${orderId}`,
      `客户支付页：${config.appUrl}/shop/checkout/${row.order_no}`,
      "下一步：等待客户付款；到账后核对金额与交易号再确认。",
    ]
      .filter(Boolean)
      .join("\n");

    const sent = await sendAlert(text, {
      event: "shop_order_created",
      orderNo: row.order_no,
    });
    if (!sent.ok) {
      console.warn("[shop] created order alert not delivered:", sent.error);
    }
  } catch (error) {
    console.warn(
      "[shop] created order alert failed",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Tells the operators that a customer paid and the order is ready to buy from
 * the supplier. The message goes to whichever channel is configured in
 * /admin/security/alerts, so the partner hears about a payment without
 * refreshing the console.
 *
 * The caller should not await this: a slow channel must never delay a payment
 * webhook or the chain scanner, and an unconfigured channel is not an error.
 */
export async function notifyShopOrderPaid(orderId: string): Promise<void> {
  try {
    const result = await query<{
      order_no: string;
      amount_micros: string | number;
      payment_provider: string;
      product_name: string;
      qty: number;
      email: string;
      preorder: boolean;
    }>(
      `SELECT o.order_no, o.amount_micros, o.payment_provider,
              i.product_name, i.qty, u.email,
              COALESCE(${preorderSql("p.")}, FALSE) AS preorder
         FROM shop_orders o
         JOIN shop_order_items i ON i.order_id = o.id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN shop_products p ON p.id = i.product_id
        WHERE o.id = $1
        LIMIT 1`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return;

    const text = [
      "【CokeAI 小店】新订单已付款",
      `订单号：${row.order_no}`,
      `商品：${row.product_name} × ${Number(row.qty)}`,
      row.preorder ? "类型：预定单（按预定顺序采购，可能延迟发货）" : "类型：现货/常规商品",
      `金额：${formatCny(toNumber(row.amount_micros))}`,
      `客户：${row.email}`,
      `渠道：${PROVIDER_LABELS[row.payment_provider] || row.payment_provider}`,
      `后台：${config.appUrl}/admin/shop/orders/${orderId}`,
      row.preorder
        ? "下一步：按预定顺序向供货商下单，回填采购信息；发货可能延迟。"
        : "下一步：去供货商下单，回填采购信息。",
    ].join("\n");

    const sent = await sendAlert(text, {
      event: "shop_order_paid",
      orderNo: row.order_no,
    });
    if (!sent.ok) {
      console.warn("[shop] paid order alert not delivered:", sent.error);
    }
  } catch (error) {
    console.warn(
      "[shop] paid order alert failed",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * The buyer says they paid by scanning the operator's Alipay QR. Nobody should
 * learn about that only by opening the console: send the transaction number to
 * the same operator channel used for paid orders.
 */
export async function notifyShopManualPaymentReported(orderId: string): Promise<void> {
  try {
    const result = await query<{
      order_no: string;
      amount_micros: string | number;
      product_name: string;
      qty: number;
      email: string;
      reported_reference: string | null;
      payer_note: string | null;
    }>(
      `SELECT o.order_no, o.amount_micros, i.product_name, i.qty, u.email,
              m.reported_reference, m.payer_note
         FROM shop_orders o
         JOIN shop_order_items i ON i.order_id = o.id
         JOIN users u ON u.id = o.user_id
         JOIN manual_alipay_payments m
           ON m.order_id = o.id AND m.order_kind = 'shop'
        WHERE o.id = $1
        LIMIT 1`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return;

    const text = [
      "【CokeAI 小店】客户已上报支付宝付款",
      `订单号：${row.order_no}`,
      `商品：${row.product_name} × ${Number(row.qty)}`,
      `金额：${formatCny(toNumber(row.amount_micros))}`,
      `客户：${row.email}`,
      `交易号：${row.reported_reference || "未填写"}`,
      row.payer_note ? `客户备注：${row.payer_note}` : null,
      `后台：${config.appUrl}/admin/shop/orders/${orderId}`,
      "下一步：到支付宝账单核对交易号与金额，再在后台确认到账。",
    ]
      .filter(Boolean)
      .join("\n");

    const sent = await sendAlert(text, {
      event: "shop_manual_payment_reported",
      orderNo: row.order_no,
    });
    if (!sent.ok) {
      console.warn("[shop] manual payment alert not delivered:", sent.error);
    }
  } catch (error) {
    console.warn(
      "[shop] manual payment alert failed",
      error instanceof Error ? error.message : error,
    );
  }
}

function formatUsdt(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * A USDT transfer that cannot become a paid order (late funds, underpayment,
 * funds on a closed order) must not wait for someone to open the dashboard.
 * Called once per deposit transition so a repeated scan does not spam.
 */
export async function notifyShopDepositAttention(input: {
  orderId: string;
  orderNo: string;
  network: UsdtNetwork;
  status: "manual" | "partial";
  expectedUsdt: number;
  receivedUsdt: number;
  reason: string;
}): Promise<void> {
  try {
    const result = await query<{
      product_name: string;
      qty: number;
      email: string;
    }>(
      `SELECT i.product_name, i.qty, u.email
         FROM shop_order_items i
         JOIN shop_orders o ON o.id = i.order_id
         JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
        LIMIT 1`,
      [input.orderId],
    );
    const row = result.rows[0];
    const text = [
      "【CokeAI 小店】USDT 到账需人工处理",
      `订单号：${input.orderNo}`,
      row ? `商品：${row.product_name} × ${Number(row.qty)}` : null,
      row ? `客户：${row.email}` : null,
      `网络：${USDT_NETWORKS[input.network].label}`,
      `应付：${formatUsdt(input.expectedUsdt)} USDT`,
      `实收：${formatUsdt(input.receivedUsdt)} USDT`,
      `原因：${input.reason}`,
      `后台：${config.appUrl}/admin/shop/deposits`,
      input.status === "manual" ? "请核实后人工处理或退款。" : "请确认是否为部分到账，必要时联系客户。",
    ]
      .filter(Boolean)
      .join("\n");

    const sent = await sendAlert(text, {
      event: "shop_deposit_attention",
      orderNo: input.orderNo,
      deposit_status: input.status,
    });
    if (!sent.ok) {
      console.warn("[shop] deposit alert not delivered:", sent.error);
    }
  } catch (error) {
    console.warn(
      "[shop] deposit alert failed",
      error instanceof Error ? error.message : error,
    );
  }
}
