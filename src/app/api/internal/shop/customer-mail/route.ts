import { sendCustomerEmail, customerMailReady } from "@/lib/alerts";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 内部发信口：给某个邮箱发一封纯文本客户邮件。
 *
 * 场景是运营侧的临时沟通——比如客户付了钱但没提交交易订单号，需要主动
 * 问一句「你下的是哪一单」。没有这个口子就只能靠人工登录邮箱发，容易
 * 发件人不对、也留不下记录。
 *
 * 保护：
 * - 需要 INTERNAL_API_SECRET（和 n8n 其他内部接口一致）；
 * - 只发纯文本，不接受 HTML，避免被当成钓鱼模板；
 * - 主题与正文都限制长度，防止拿它当群发器。
 *
 *   POST /api/internal/shop/customer-mail
 *   { "to": "a@b.com", "subject": "...", "text": "..." }
 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  if (!(await customerMailReady())) {
    return Response.json(
      { ok: false, error: "smtp_not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let payload: { to?: unknown; subject?: unknown; text?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const to = typeof payload.to === "string" ? payload.to.trim() : "";
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const text = typeof payload.text === "string" ? payload.text.trim() : "";

  if (!to || !subject || !text) {
    return Response.json(
      { ok: false, error: "to/subject/text 均为必填" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (subject.length > 120 || text.length > 4000) {
    return Response.json(
      { ok: false, error: "subject 最多 120 字，正文最多 4000 字" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await sendCustomerEmail({ to, subject, text });
  return Response.json(
    { ok: result.ok, error: result.error ?? null },
    {
      status: result.ok ? 200 : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
