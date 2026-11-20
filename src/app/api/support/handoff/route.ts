import { getCurrentUser } from "@/lib/auth";
import { fixedWindowLimit } from "@/lib/rate-limit";
import { json, readMessages } from "@/lib/support-chat";
import { createTicket } from "@/lib/support";
import { notifySupportHandoff } from "@/lib/shop/notify";
import { listUserShopOrders } from "@/lib/shop/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "待支付",
  paid: "已支付待采购",
  procuring: "采购中",
  delivered: "已发货",
  cancelled: "已取消",
  expired: "已过期",
  refund_pending: "退款处理中",
  refunded: "已退款",
};

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 16 * 1024) return json({ error: "请求体过大。" }, 413);

  const user = await getCurrentUser();
  if (!user) {
    return json({ error: "login_required" }, 401);
  }

  const limit = await fixedWindowLimit(`cc:support:handoff:${user.id}`, 3, 3600);
  if (!limit.allowed) {
    return json(
      { error: "转人工提交有点频繁，请稍后再试，或发邮件给售后。" },
      429,
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求格式不正确。" }, 400);
  }

  const messages = readMessages((payload as { messages?: unknown })?.messages);
  if (!messages) {
    return json({ error: "请先和 AI 客服聊几句再转人工。" }, 400);
  }
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return json({ error: "请先和 AI 客服聊几句再转人工。" }, 400);
  }

  const transcript = messages
    .map((message) =>
      message.role === "user" ? `顾客：${message.content}` : `AI 客服：${message.content}`,
    )
    .join("\n");

  // 附上最近一单，运营不用再追问订单号；顾客没有订单时静默省略。
  let orderId: string | null = null;
  let orderLine = "";
  try {
    const orders = await listUserShopOrders(user.id);
    const latest = orders[0];
    if (latest) {
      orderId = latest.id;
      const label = ORDER_STATUS_LABEL[latest.status] || latest.status;
      orderLine = `顾客最近订单：${latest.order_no}（${label}）。`;
    }
  } catch {
    // 查询失败不阻塞转人工。
  }

  const subject = firstUserMessage.content.slice(0, 40);
  const message = [
    "【来自在线客服转人工】以下是顾客与 AI 客服的对话记录：",
    transcript,
    orderLine,
  ]
    .filter(Boolean)
    .join("\n");

  const ticketId = await createTicket({ userId: user.id, subject, message, orderId });
  void notifySupportHandoff(ticketId);

  return json({ ticketId });
}
