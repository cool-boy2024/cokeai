import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getSupportImage } from "@/lib/support/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_PATTERN = /^([a-f0-9]{64})\.(png|jpe?g|webp)$/;

/**
 * 工单图片读取。
 *
 * **必须鉴权**：收款码、报错截图都是客户的隐私，不能像商品图那样公开。
 * 只有两种情况能看：
 *   1. 这张图属于某个工单，而这个工单是当前用户自己的；
 *   2. 当前用户是管理员。
 *
 * 图片内容是内容寻址的（sha256），所以可以放心长缓存——URL 变了内容才会变。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const match = FILE_PATTERN.exec(file);
  if (!match) {
    return new Response("Bad Request", { status: 400 });
  }
  const hash = match[1];

  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 管理员看全部；客户只看自己的图——工单里的图，或自己订单的付款截图。
  if (user.role !== "admin") {
    const owned = await query<{ ok: boolean }>(
      `SELECT TRUE AS ok
         FROM support_message_images mi
         JOIN support_ticket_messages m ON m.id = mi.message_id
         JOIN support_tickets t ON t.id = m.ticket_id
        WHERE mi.image_hash = $1 AND t.user_id = $2
        UNION ALL
       SELECT TRUE AS ok
         FROM manual_payment_images pi
         JOIN shop_orders o ON o.id = pi.order_id
        WHERE pi.image_hash = $1 AND o.user_id = $2
        LIMIT 1`,
      [hash, user.id],
    );
    if (!owned.rows[0]) {
      // 不区分「不存在」和「不属于你」，避免泄露图片是否存在。
      return new Response("Not Found", { status: 404 });
    }
  }

  const image = await getSupportImage(hash);
  if (!image) {
    return new Response("Not Found", { status: 404 });
  }

  const body = new Uint8Array(image.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(body.byteLength),
      // 内容寻址：同一个 hash 永远是同一张图。
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
      // 客户上传的图不该被当成页面执行。
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
