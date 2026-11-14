import { sendAlert } from "@/lib/alerts";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a predefined operational note to the partner mailbox. Only fixed
 * messages are accepted so the internal secret cannot be used as a general
 * email relay; the SMTP credentials stay inside the app.
 */
const NOTES: Record<string, { subjectEvent: string; text: string }> = {
  "balance-order-update-failed-explainer": {
    subjectEvent: "shop_balance_ops_note",
    text: [
      "【CokeAI 小店】余额支付异常处理说明",
      "",
      "背景：余额支付分两步——",
      "① 从客户的 CokeAI 账户余额扣款；",
      "② 把订单标记为已支付。",
      "正常情况下两步都成功。极少数情况下（数据库写入失败、容器重启、并发锁冲突），",
      "第①步扣款成功、第②步订单状态没写进去，订单会暂时显示待支付。",
      "",
      "出现这种情况时，系统会给伙伴邮箱发一条「余额已扣款但订单状态更新失败」的提醒，",
      "内容包括订单号、用户、金额。收到后：",
      "1. 到后台打开对应订单，确认这笔余额流水已扣；",
      "2. 把订单确认为已支付；",
      "3. 不要让客户再付一次。",
      "",
      "为什么重试安全：扣款流水按订单号幂等，客户在支付页点「重新尝试余额支付」",
      "只会核对原流水，不会二次扣钱；页面也会提示「不会重复扣款」。",
      "",
      "这是一条一次性说明，不需要回复。",
    ].join("\n"),
  },
};

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  let body: { note?: unknown } = {};
  try {
    body = (await request.json()) as { note?: unknown };
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note : "";
  const message = NOTES[note];
  if (!message) {
    return Response.json({ error: "unknown note" }, { status: 400 });
  }
  const result = await sendAlert(message.text, {
    event: message.subjectEvent,
    note,
  });
  return Response.json(
    { ok: result.ok, error: result.error ?? null },
    {
      status: result.ok ? 200 : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
