"use client";

import Link from "next/link";
import { ArrowClockwise, ArrowLeft } from "@phosphor-icons/react";
import { Logo } from "@/components/Logo";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="error-page">
      <div className="error-card">
        <Logo />
        <div className="mono small muted mt-24">SYSTEM / UNEXPECTED_ERROR</div>
        <h1>页面暂时无法加载。</h1>
        <p>
          请求没有完成。你可以重试；如果问题持续，请把时间与页面路径发给技术支持。
        </p>
        {error.digest ? (
          <div className="inline-code small">错误标识：{error.digest}</div>
        ) : null}
        <div className="error-actions">
          <button className="btn btn-dark" onClick={reset} type="button">
            <ArrowClockwise size={15} /> 重试
          </button>
          <Link className="btn btn-ghost" href="/">
            <ArrowLeft size={15} /> 返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
