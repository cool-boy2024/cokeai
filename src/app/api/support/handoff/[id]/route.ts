import { getCurrentUser } from "@/lib/auth";
import { fixedWindowLimit } from "@/lib/rate-limit";
import { json } from "@/lib/support-chat";
import {
  addCustomerReply,
  getTicketForUser,
  listTicketMessages,
  markTicketReadByCustomer,
} from "@/lib/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE = 600;
const MAX_MESSAGES = 50;

/**
 * 转人工之后悬浮窗与工单之间的桥：轮询管理员回复 + 顾客继续追问。
 * 全部走会话鉴权，且只能看到自己的工单。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "login_required" }, 401);

  const ticket = await getTicketForUser(id, user.id);
  if (!ticket) return json({ error: "not_found" }, 404);

  const all = await listTicketMessages(id);
  const messages = all.slice(-MAX_MESSAGES);
  await markTicketReadByCustomer(id, user.id);

  return json({
    status: ticket.status,
    subject: ticket.subject,
    messages: messages.map((message) => ({
      author: message.author,
      content: message.body,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return json({ error: "login_required" }, 401);

  const limit = await fixedWindowLimit(`cc:support:handoff-msg:${user.id}`, 10, 300);
  if (!limit.allowed) {
    return json({ error: "发送有点频繁，请稍等运营回复。" }, 429);
  }

  const ticket = await getTicketForUser(id, user.id);
  if (!ticket) return json({ error: "not_found" }, 404);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求格式不正确。" }, 400);
  }
  const content = String((payload as { content?: unknown }).content || "").trim();
  if (!content) return json({ error: "消息不能为空。" }, 400);

  await addCustomerReply({
    ticketId: id,
    userId: user.id,
    message: content.slice(0, MAX_MESSAGE),
  });

  return json({ ok: true });
}
