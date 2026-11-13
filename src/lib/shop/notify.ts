import { config } from "@/lib/config";
import { sendAlert } from "@/lib/alerts";
import { query, toNumber } from "@/lib/db";
import { formatCny } from "@/lib/money";

const PROVIDER_LABELS: Record<string, string> = {
  alipay_easypay: "支付宝",
  alipay_manual: "支付宝（人工收款）",
  usdt_trc20: "USDT TRC20",
  usdt_bsc: "USDT BEP20（BSC）",
  usdt_polygon: "USDT Polygon",
  manual: "人工确认",
};

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
    }>(
      `SELECT o.order_no, o.amount_micros, o.payment_provider,
              i.product_name, i.qty, u.email
         FROM shop_orders o
         JOIN shop_order_items i ON i.order_id = o.id
         JOIN users u ON u.id = o.user_id
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
      `金额：${formatCny(toNumber(row.amount_micros))}`,
      `客户：${row.email}`,
      `渠道：${PROVIDER_LABELS[row.payment_provider] || row.payment_provider}`,
      `后台：${config.appUrl}/admin/shop/orders/${orderId}`,
      "下一步：去供货商下单，回填采购信息。",
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
