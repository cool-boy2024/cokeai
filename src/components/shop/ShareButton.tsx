"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ShareNetwork } from "@phosphor-icons/react";

/**
 * 商品页的分享按钮。
 *
 * 手机上走系统分享面板（Web Share API），其它情况复制链接。两种路径都只
 * 分享本站地址，不暴露货源页面。
 */
export function ShareButton({ title, path }: { title: string; path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const reset = (next: "copied" | "failed") => {
    setState(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2400);
  };

  const url =
    typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();

  const onShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // 用户取消不算失败，直接回到静默状态。
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      reset("copied");
    } catch {
      reset("failed");
    }
  };

  const label = state === "copied" ? "链接已复制" : state === "failed" ? "复制失败" : "分享";

  return (
    <button
      type="button"
      className="shop-badge shop-badge-share"
      onClick={onShare}
      aria-live="polite"
    >
      {state === "copied" ? (
        <Check size={13} weight="bold" />
      ) : state === "failed" ? (
        <Copy size={13} />
      ) : (
        <ShareNetwork size={13} weight="bold" />
      )}
      {label}
    </button>
  );
}
