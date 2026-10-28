"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChatCircleDots, PaperPlaneTilt, X } from "@phosphor-icons/react";

type Message = { role: "user" | "assistant"; content: string };

const QUICK_QUESTIONS = [
  "怎么充值？",
  "小店多久发货？",
  "有哪些模型？",
  "怎么申请退款？",
];

const GREETING =
  "你好，我是 CokeAI 客服。充值、小店发货、模型价格和 API 接入的问题都可以问我。";

export function SupportWidget({ supportEmail }: { supportEmail: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hiddenPath =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (hiddenPath) return null;

  const send = async (value?: string) => {
    const content = (value ?? input).trim();
    if (!content || sending) return;

    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setSending(true);

    let reply = `客服暂时连不上。可以发邮件到 ${supportEmail}，我们会尽快回复。`;
    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-6).map(({ role, content: text }) => ({
            role,
            content: text,
          })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        reply?: unknown;
      };
      if (typeof data.reply === "string" && data.reply.trim()) {
        reply = data.reply.trim();
      }
    } catch {
      // Keep the fallback reply.
    } finally {
      setSending(false);
    }

    setMessages([...next, { role: "assistant", content: reply }]);
  };

  return (
    <div className={`support-widget${open ? " is-open" : ""}`}>
      {open ? (
        <section
          id="cokeai-support-panel"
          className="support-panel"
          role="dialog"
          aria-label="CokeAI 在线客服"
        >
          <header className="support-head">
            <div>
              <strong>在线客服</strong>
              <span>
                <i aria-hidden="true" />
                AI 客服 · 通常立即回复
              </span>
            </div>
            <button
              type="button"
              className="support-close"
              aria-label="关闭客服"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>

          <div className="support-log" ref={logRef} aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`support-msg is-${message.role}`}
              >
                {message.content}
              </div>
            ))}
            {sending ? (
              <div className="support-typing" aria-label="客服正在输入">
                <i />
                <i />
                <i />
              </div>
            ) : null}
          </div>

          {messages.length <= 1 && !sending ? (
            <div className="support-chips">
              {QUICK_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => send(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="support-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={600}
              placeholder="输入你的问题"
              aria-label="输入你的问题"
            />
            <button
              type="submit"
              aria-label="发送"
              disabled={sending || !input.trim()}
            >
              <PaperPlaneTilt size={16} />
            </button>
          </form>

          <p className="support-foot">
            AI 客服 · 复杂问题请发邮件{" "}
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          </p>
        </section>
      ) : null}

      <button
        type="button"
        className="support-launch"
        aria-label={open ? "关闭在线客服" : "打开在线客服"}
        aria-expanded={open}
        aria-controls="cokeai-support-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <ChatCircleDots size={22} />
        <span>客服</span>
      </button>
    </div>
  );
}
