import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/AuthForm";
import { AuthTunnel } from "@/components/auth/AuthTunnel";
import { Logo } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";
import "../auth-tunnel.css";

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
      <AuthTunnel />
      <header className="auth-topbar">
        <Logo />
        <Link className="auth-back" href="/">
          <ArrowLeft size={14} /> 返回首页
        </Link>
      </header>
      <main id="main-content" className="auth-main">
        <div className="auth-stage">
          <aside className="auth-intro" aria-hidden="true">
            <p className="auth-kicker">CokeAI · 身份节点</p>
            <p className="auth-display">
              穿过隧道，
              <br />
              <span>建立你的新入口。</span>
            </p>
            <p className="auth-intro-note">
              注册后充值即可使用，余额不过期，订单随时可查。
            </p>
            <p className="auth-intro-foot">
              <span>01 / 创建身份</span>
              <i />
              <span>02 / 进入控制台</span>
            </p>
          </aside>
          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-card-head">
              <p className="auth-eyebrow">安全入口 · AUTH</p>
              <h2 id="auth-title">创建账户</h2>
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
