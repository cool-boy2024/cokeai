import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/AuthForm";
import { AuthGalaxy } from "@/components/auth/AuthGalaxy";
import { Logo } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";
import { authHref, safeNextPath } from "@/lib/redirects";
import "../auth-galaxy.css";

export const metadata: Metadata = {
  title: "创建账户",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; next?: string }>;
}) {
  const user = await getCurrentUser();
  const { ref, next } = await searchParams;
  const refCode = (ref || "").trim().toUpperCase().slice(0, 32) || undefined;
  const safeNext = next ? safeNextPath(next, "") || undefined : undefined;
  if (user) {
    redirect(safeNext || (user.role === "admin" ? "/admin" : "/dashboard"));
  }
  // Signing up mid-purchase should not lose the product page the buyer came
  // from; keep the login link symmetric with the one on /login.
  const loginHref = authHref("/login", { next: safeNext, ref: refCode });

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
            <p className="auth-kicker">CokeAI · 数字小店</p>
            <p className="auth-display">
              欢迎来到
              <span className="auth-display-brand">CokeAI</span>
            </p>
            <p className="auth-intro-foot">
              <span className="auth-intro-dot" />
              数字商品 · 人工发货
            </p>
          </aside>
          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-card-head">
              <p className="auth-welcome">
                欢迎来到 <strong>CokeAI</strong>
              </p>
              <p className="auth-eyebrow">安全入口 · AUTH</p>
              <h1 id="auth-title">创建账户</h1>
              <p className="auth-sub">
                {safeNext?.startsWith("/shop/")
                  ? "注册后自动回到刚才的商品页，继续完成下单。"
                  : "注册后即可在小店下单，订单进度随时可查。"}
              </p>
            </div>
            <AuthForm mode="register" next={safeNext} refCode={refCode} />
            <p className="auth-switch">
              已有账户？ <Link href={loginHref}>登录</Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
