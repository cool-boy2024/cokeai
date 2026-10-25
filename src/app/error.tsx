"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      style={{
        display: "grid",
        minHeight: "100vh",
        placeItems: "center",
        background: "var(--paper)",
        padding: 24,
      }}
    >
      <div style={{ width: "min(440px, 100%)" }}>
        <Logo />
        <div className="mono small muted mt-24">SYSTEM / UNEXPECTED_ERROR</div>
        <h1 style={{ margin: "8px 0 12px", fontSize: 42, letterSpacing: "-0.06em" }}>
          页面暂时无法加载。
        </h1>
        <p className="muted">
          请求没有完成。你可以重试；如果问题持续，请把时间与页面路径发给技术支持。
        </p>
        {error.digest ? (
          <div className="inline-code small">错误标识：{error.digest}</div>
        ) : null}
        <div className="flex gap-8 mt-24">
          <button className="btn btn-dark" onClick={reset} type="button">
            重试
          </button>
          <Link className="btn btn-ghost" href="/">
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
