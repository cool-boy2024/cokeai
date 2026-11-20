/** Shared request parsing for the support chat and handoff endpoints. */

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";
export const MAX_HISTORY = 8;
export const MAX_CONTENT = 600;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function clientIp(request: Request): string {
  const forwarded =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "";
  return forwarded.split(",")[0].trim() || "local";
}

export function readMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    messages.push({ role, content: trimmed.slice(0, MAX_CONTENT) });
  }
  return messages.slice(-MAX_HISTORY);
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const HANDOFF_PATTERN = /转人工|人工客服|真人客服|找人工|人工/;

/** True when the last user message is asking for a human operator. */
export function wantsHandoff(messages: ChatMessage[]): boolean {
  const last = [...messages].reverse().find((message) => message.role === "user");
  return Boolean(last && HANDOFF_PATTERN.test(last.content));
}
