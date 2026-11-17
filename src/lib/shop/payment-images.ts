import { query } from "@/lib/db";

/**
 * 客户付款凭证截图。
 *
 * 图片本体存在 support_images（内容寻址、按 sha256 去重），这里只记录它
 * 挂在哪张订单上。读图走 /api/support/images/[file]，鉴权同时覆盖工单图片
 * 和付款截图。
 *
 * 截图是辅助证据：上面通常有付款时间、金额，以及客户在备注里填的订单号。
 * 运营要拿它和支付宝账单（官方数据）交叉核对，所以它有上限——
 * 不要变成客户上传几十张图来占存储。
 */
export const MAX_PAYMENT_IMAGES = 2;

export type PaymentImage = { hash: string; ext: string };

export async function attachPaymentImages(
  orderId: string,
  hashes: string[],
): Promise<void> {
  const unique = [...new Set(hashes)].slice(0, MAX_PAYMENT_IMAGES);
  for (let i = 0; i < unique.length; i += 1) {
    await query(
      `INSERT INTO manual_payment_images (order_id, image_hash, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_id, image_hash) DO NOTHING`,
      [orderId, unique[i], i],
    );
  }
}

export async function loadPaymentImages(orderId: string): Promise<PaymentImage[]> {
  const rows = await query<{ hash: string; ext: string }>(
    `SELECT si.hash, si.ext
       FROM manual_payment_images pi
       JOIN support_images si ON si.hash = pi.image_hash
      WHERE pi.order_id = $1
      ORDER BY pi.position ASC, pi.created_at ASC`,
    [orderId],
  );
  return rows.rows;
}

/** 一次取多张订单的截图，避免对账台逐行查询。 */
export async function loadPaymentImagesForOrders(
  orderIds: string[],
): Promise<Map<string, PaymentImage[]>> {
  const grouped = new Map<string, PaymentImage[]>();
  if (orderIds.length === 0) return grouped;
  const rows = await query<{ order_id: string; hash: string; ext: string }>(
    `SELECT pi.order_id, si.hash, si.ext
       FROM manual_payment_images pi
       JOIN support_images si ON si.hash = pi.image_hash
      WHERE pi.order_id = ANY($1::uuid[])
      ORDER BY pi.position ASC, pi.created_at ASC`,
    [orderIds],
  );
  for (const row of rows.rows) {
    const list = grouped.get(row.order_id) || [];
    list.push({ hash: row.hash, ext: row.ext });
    grouped.set(row.order_id, list);
  }
  return grouped;
}
