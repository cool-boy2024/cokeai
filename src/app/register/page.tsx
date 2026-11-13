import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/AuthForm";
import { AuthGalaxy } from "@/components/auth/AuthGalaxy";
import { Logo } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";
import "../auth-galaxy.css";

export const metadata: Metadata = {
  title: "创建账户",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/dashboard");
  const { ref } = await searchParams;
  const refCode = (ref || "").trim().toUpperCase().slice(0, 32) || undefined;

  return (
    <div className="auth-page auth-page-simple auth-space">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <AuthGalaxy />
      <header className="auth-topbar">
        <Logo />
        <Link className="auth-back" href="/">
          <ArrowLeft size={14} /> 返回首页
        </Link>
      </header>
      <main id="main-content" className="auth-main">
        <div className="auth-stage">
          <aside className="auth-intro" aria-label="CokeAI 介绍">
            <p className="auth-kicker">CokeAI · AI 生态</p>
            <p className="auth-display">
              欢迎来到
              <span className="auth-display-brand">CokeAI</span>
            </p>
            <p className="auth-intro-foot">
              <span className="auth-intro-dot" />
              AI API · 数字商品
            </p>
          </aside>
          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-card-head">
              <p className="auth-welcome">
                欢迎来到 <strong>CokeAI</strong>
              </p>
              <p className="auth-eyebrow">安全入口 · AUTH</p>
              <h1 id="auth-title">创建账户</h1>
              <p className="auth-sub">注册后充值即可使用，余额不过期。</p>
            </div>
            <AuthForm mode="register" refCode={refCode} />
            <p className="auth-switch">
              已有账户？ <Link href="/login">登录</Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
