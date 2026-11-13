"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardText, Copy } from "@phosphor-icons/react";

/**
 * Browser-only TOTP generator (RFC 6238, 6 digits, 30 seconds, HMAC-SHA1).
 *
 * The secret never leaves this component: it is decoded from Base32 and signed
 * with Web Crypto in the page itself. Nothing is stored, and the page makes no
 * network requests, so a pasted key is gone when the tab closes.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const MIN_SECRET_LENGTH = 16;
const TYPICAL_SECRET_LENGTH = 32;

function normalizeSecret(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

function isValidSecret(secret: string): boolean {
  return (
    secret.length >= MIN_SECRET_LENGTH &&
    secret.length <= 128 &&
    /^[A-Z2-7]+$/.test(secret)
  );
}

function base32Decode(secret: string): Uint8Array<ArrayBuffer> {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("密钥含有不是 Base32 的字符");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

async function generateCode(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 4_294_967_296));
  view.setUint32(4, counter >>> 0);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, message),
  );
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function TwoFactorTool() {
  const [input, setInput] = useState("");
  const [activeSecret, setActiveSecret] = useState("");
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(PERIOD_SECONDS);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const normalized = normalizeSecret(input);
  const lengthClass =
    normalized.length === TYPICAL_SECRET_LENGTH
      ? " is-complete"
      : normalized.length > 0
        ? " is-partial"
        : "";

  useEffect(() => {
    if (!activeSecret) return;
    let cancelled = false;
    let lastCounter = -1;

    const tick = async () => {
      const now = Math.floor(Date.now() / 1000);
      const counter = Math.floor(now / PERIOD_SECONDS);
      if (!cancelled) {
        setRemaining(PERIOD_SECONDS - (now % PERIOD_SECONDS));
      }
      if (counter === lastCounter) return;
      lastCounter = counter;
      try {
        const next = await generateCode(activeSecret, counter);
        if (!cancelled) {
          setCode(next);
          setError("");
        }
      } catch {
        if (!cancelled) setError("无法生成验证码，请确认密钥是 Base32 格式。");
      }
    };

    void tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSecret]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const generate = useCallback(async (raw: string, fromClipboard: boolean) => {
    const secret = normalizeSecret(raw);
    if (!secret || !isValidSecret(secret)) {
      // Drop the previous code: it no longer belongs to what is in the input.
      setActiveSecret("");
      setCode("");
      setError(
        !secret
          ? "请先粘贴 2FA 新密钥。"
          : `密钥需要是 16–128 位 Base32 字符（A–Z、2–7）。当前 ${secret.length} 位，请检查是否复制完整。`,
      );
      setNote("");
      return;
    }
    try {
      const now = Math.floor(Date.now() / 1000);
      const next = await generateCode(secret, Math.floor(now / PERIOD_SECONDS));
      setActiveSecret(secret);
      setCode(next);
      setRemaining(PERIOD_SECONDS - (now % PERIOD_SECONDS));
      setError("");
      setNote(
        fromClipboard
          ? "已从剪贴板读取新密钥并生成验证码。"
          : "验证码已生成，30 秒后自动换新。",
      );
    } catch {
      setError("无法生成验证码，请确认密钥是 Base32 格式。");
      setNote("");
    }
  }, []);

  const pasteAndGenerate = useCallback(async () => {
    let candidate = input;
    let fromClipboard = false;
    try {
      const text = await navigator.clipboard.readText();
      if (isValidSecret(normalizeSecret(text))) {
        candidate = text;
        fromClipboard = true;
        setInput(text.trim());
      }
    } catch {
      // Clipboard read needs permission; the input value still works.
    }
    await generate(candidate, fromClipboard);
  }, [generate, input]);

  const copyCode = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setNote("验证码已复制，回到添加 2FA 的页面粘贴即可。");
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("复制失败，请长按验证码手动复制。");
    }
  }, [code]);

  return (
    <div className="twofa-card">
      <div className="twofa-field">
        <label htmlFor="twofa-secret">2FA 新密钥</label>
        <input
          id="twofa-secret"
          className="twofa-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void pasteAndGenerate();
            }
          }}
          placeholder="粘贴 32 位新密钥，例如 JBSWY3DPEHPK3PXP…"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby="twofa-secret-help"
        />
        <div className="twofa-field-meta" id="twofa-secret-help">
          <span className={`twofa-length${lengthClass}`}>
            密钥长度 {normalized.length}/{TYPICAL_SECRET_LENGTH}
          </span>
          <span>仅在本页内存中使用，不会发送或保存</span>
        </div>
        <div className="twofa-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void pasteAndGenerate()}
          >
            <ClipboardText size={16} />
            粘贴并生成
          </button>
          <button
            className="btn btn-light"
            type="button"
            onClick={() => setInput("")}
            disabled={!input}
          >
            清空
          </button>
        </div>
      </div>

      <div className={`twofa-code${code ? " is-live" : ""}`}>
        <span className="twofa-code-label">动态验证码</span>
        <strong className="twofa-code-value" aria-live="polite">
          {code ? formatCode(code) : "--- ---"}
        </strong>
        {activeSecret ? (
          <>
            <div className="twofa-progress" aria-hidden="true">
              <span
                style={{
                  width: `${Math.max(0, Math.min(100, (remaining / PERIOD_SECONDS) * 100))}%`,
                }}
              />
            </div>
            <div className="twofa-code-foot">
              <span aria-live="polite">{remaining} 秒后自动换新</span>
              <button
                className="btn btn-light"
                type="button"
                onClick={() => void copyCode()}
                disabled={!code}
              >
                <Copy size={16} />
                {copied ? "已复制" : "复制验证码"}
              </button>
            </div>
          </>
        ) : (
          <p className="twofa-code-hint">粘贴密钥后点击「粘贴并生成」</p>
        )}
      </div>

      {error ? (
        <p className="twofa-msg is-error" role="alert">
          {error}
        </p>
      ) : note ? (
        <p className="twofa-msg is-note">{note}</p>
      ) : null}
    </div>
  );
}
