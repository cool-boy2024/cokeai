"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatCircleDots, Headset, PaperPlaneTilt, X } from "@phosphor-icons/react";

type MessageKind = "user" | "bot" | "operator" | "system";

type Message = { kind: MessageKind; content: string };

const QUICK_QUESTIONS = [
  "怎么充值？",
  "小店多久发货？",
  "有哪些模型？",
  "怎么申请退款？",
];

const GREETING =
  "你好，我是 CokeAI 客服。商品咨询、下单和发货进度的问题都可以问我。";

const HANDOFF_STORAGE_KEY = "cokeai_handoff_ticket";
const POLL_INTERVAL_MS = 5_000;

type HandoffResponse = {
  status?: string;
  messages?: Array<{ author?: unknown; content?: unknown }>;
  error?: string;
};

function handoffMessagesFrom(data: HandoffResponse): Message[] {
  const messages: Message[] = [];
  for (const item of data.messages || []) {
    if (typeof item.content !== "string" || !item.content.trim()) continue;
    messages.push({
      kind: item.author === "admin" ? "operator" : "user",
      content: item.content,
    });
  }
  return messages;
}

export function SupportWidget({ supportEmail }: { supportEmail: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ai" | "human">("ai");
  const [messages, setMessages] = useState<Message[]>([
    { kind: "bot", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffHint, setHandoffHint] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketClosed, setTicketClosed] = useState(false);
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

  const CLOSED_NOTICE = "工单已结束。还有问题可以继续问 AI 客服，或重新转人工。";

  const refreshHandoff = useCallback(async () => {
    if (!ticketId) return null;
    try {
      const response = await fetch(`/api/support/handoff/${ticketId}`, {
        cache: "no-store",
      });
      if (response.status === 404) {
        localStorage.removeItem(HANDOFF_STORAGE_KEY);
        return null;
      }
      if (!response.ok) return null;
      const data = (await response.json()) as HandoffResponse;
      const next = handoffMessagesFrom(data);
      const closed = data.status === "closed";
      if (next.length > 0) setMessages(next);
      if (closed) {
        setMessages((prev) =>
          prev.some(
            (message) =>
              message.kind === "system" && message.content === CLOSED_NOTICE,
          )
            ? prev
            : [...prev, { kind: "system", content: CLOSED_NOTICE }],
        );
      }
      setTicketClosed(closed);
      return { messages: next, closed };
    } catch {
      return null;
    }
  }, [ticketId]);

  // 刷新/重开页面后恢复进行中的人工会话。
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(HANDOFF_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let stored: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { ticketId?: unknown };
      if (typeof parsed.ticketId === "string") stored = parsed.ticketId;
    } catch {
      return;
    }
    if (typeof stored !== "string" || !stored) return;
    void (async () => {
      setTicketId(stored);
      // refreshHandoff 依赖 ticketId state，这里直接带 id 拉一次。
      try {
        const response = await fetch(`/api/support/handoff/${stored}`, {
          cache: "no-store",
        });
        if (response.status === 404) {
          localStorage.removeItem(HANDOFF_STORAGE_KEY);
          setTicketId(null);
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as HandoffResponse;
        const next = handoffMessagesFrom(data);
        if (next.length > 0) setMessages(next);
        setTicketClosed(data.status === "closed");
        setMode("human");
      } catch {
        // 网络失败时保持 AI 模式，下次打开面板再试。
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 人工模式下轮询运营回复：面板打开/切回标签页时立即拉一次，之后定时。
  useEffect(() => {
    if (mode !== "human" || !ticketId || !open || ticketClosed) return;
    let cancelled = false;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshHandoff().then((result) => {
        if (cancelled) return;
        if (result?.closed) setTicketClosed(true);
      });
    };
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [mode, ticketId, open, ticketClosed, refreshHandoff]);

  if (hiddenPath) return null;

  const chatMessages = messages.filter(
    (message) => message.kind === "user" || message.kind === "bot",
  );

  const sendAi = async (content: string) => {
    const next: Message[] = [...messages, { kind: "user", content }];
    setMessages(next);
    setSending(true);

    let reply = `客服暂时连不上。可以发邮件到 ${supportEmail}，我们会尽快回复。`;
    let hint = false;
    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-6).map((message) => ({
            role: message.kind === "user" ? "user" : "assistant",
            content: message.content,
          })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        reply?: unknown;
        handoffHint?: unknown;
      };
      if (typeof data.reply === "string" && data.reply.trim()) {
        reply = data.reply.trim();
      }
      hint = data.handoffHint === true;
    } catch {
      // Keep the fallback reply.
    } finally {
      setSending(false);
    }

    setMessages([...next, { kind: "bot", content: reply }]);
    if (hint) setHandoffHint(true);
  };

  const sendHuman = async (content: string) => {
    if (!ticketId || ticketClosed) return;
    const next: Message[] = [...messages, { kind: "user", content }];
    setMessages(next);
    setSending(true);
    try {
      const response = await fetch(`/api/support/handoff/${ticketId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (response.status === 429) {
        setMessages([
          ...next,
          { kind: "system", content: "发送有点频繁，请稍等运营回复。" },
        ]);
      } else if (response.ok) {
        await refreshHandoff();
      } else {
        setMessages([
          ...next,
          { kind: "system", content: "这条消息没发出去，请稍后重试。" },
        ]);
      }
    } catch {
      setMessages([
        ...next,
        { kind: "system", content: "网络似乎不太稳定，请稍后重试。" },
      ]);
    } finally {
      setSending(false);
    }
  };

  const send = (value?: string) => {
    const content = (value ?? input).trim();
    if (!content || sending) return;
    setInput("");
    void (mode === "human" ? sendHuman(content) : sendAi(content));
  };

  const startHandoff = async () => {
    if (handoffBusy) return;
    setHandoffBusy(true);
    try {
      const response = await fetch("/api/support/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: chatMessages.slice(-8).map((message) => ({
            role: message.kind === "user" ? "user" : "assistant",
            content: message.content,
          })),
        }),
      });
      if (response.status === 401) {
        setLoginPrompt(true);
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        ticketId?: unknown;
        error?: unknown;
      };
      if (!response.ok || typeof data.ticketId !== "string") {
        setMessages([
          ...messages,
          {
            kind: "system",
            content:
              typeof data.error === "string" && data.error
                ? data.error
                : "暂时转不了人工，请稍后再试或发邮件。",
          },
        ]);
        return;
      }
      try {
        localStorage.setItem(
          HANDOFF_STORAGE_KEY,
          JSON.stringify({ ticketId: data.ticketId }),
        );
      } catch {
        // 隐私模式下存不了也没关系，本次会话内仍然可用。
      }
      setTicketId(data.ticketId);
      setTicketClosed(false);
      setLoginPrompt(false);
      setHandoffHint(false);
      setMessages([
        ...messages,
        {
          kind: "system",
          content: `已转人工 · 工单 #${data.ticketId.slice(0, 8)}，运营会直接在这里回复你。`,
        },
      ]);
      setMode("human");
    } catch {
      setMessages([
        ...messages,
        { kind: "system", content: "网络似乎不太稳定，请稍后再试。" },
      ]);
    } finally {
      setHandoffBusy(false);
    }
  };

  const backToAi = () => {
    try {
      localStorage.removeItem(HANDOFF_STORAGE_KEY);
    } catch {
      // ignore
    }
    setTicketId(null);
    setTicketClosed(false);
    setMode("ai");
    setMessages([{ kind: "bot", content: GREETING }]);
  };

  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

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
                {mode === "human"
                  ? `人工客服 · 工单 #${ticketId?.slice(0, 8) || ""}`
                  : "AI 客服 · 通常立即回复"}
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
                key={`${message.kind}-${index}`}
                className={`support-msg is-${message.kind}`}
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

          {loginPrompt ? (
            <div className="support-banner">
              转人工需要登录，这样运营才能把回复送达给你。
              <Link href={loginHref}>点此登录</Link>，登录后回来继续即可。
            </div>
          ) : null}

          {mode === "ai" && messages.length <= 1 && !sending ? (
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
              send();
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={600}
              placeholder={
                mode === "human"
                  ? ticketClosed
                    ? "工单已结束"
                    : "输入你的问题，运营会尽快回复"
                  : "输入你的问题"
              }
              aria-label="输入你的问题"
              disabled={mode === "human" && ticketClosed}
            />
            <button
              type="submit"
              aria-label="发送"
              disabled={
                sending ||
                !input.trim() ||
                (mode === "human" && ticketClosed)
              }
            >
              <PaperPlaneTilt size={16} />
            </button>
          </form>

          {mode === "human" && ticketClosed ? (
            <button type="button" className="support-handoff-btn" onClick={backToAi}>
              返回 AI 客服
            </button>
          ) : null}

          <p className="support-foot">
            {mode === "human" ? (
              <>
                人工进行中 · 回复也会同步到
                <Link href="/dashboard/support">售后工单</Link>
              </>
            ) : (
              <>
                {handoffHint ? "AI 解决不了？可以" : ""}
                <button
                  type="button"
                  className={`support-handoff-btn${handoffHint ? " is-hint" : ""}`}
                  onClick={() => void startHandoff()}
                  disabled={handoffBusy}
                >
                  <Headset size={14} />
                  {handoffBusy ? "提交中…" : "转人工"}
                </button>
                ·复杂问题也可
                <Link href="/dashboard/support">提交售后工单</Link>
                {" "}或发邮件 <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
              </>
            )}
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
