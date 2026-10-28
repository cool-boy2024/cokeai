import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "登录",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/dashboard");
  const { next } = await searchParams;
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <div className="auth-page auth-page-simple">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <main id="main-content" className="auth-main">
        <div className="auth-card">
          <Link className="text-link small" href="/">
            <span className="vertical-align">
              <ArrowLeft size={13} /> 返回首页
            </span>
          </Link>
          <div className="auth-logo">
            <Logo />
          </div>
          <h2>登录</h2>
          <p className="auth-sub">继续管理你的 API Key 和余额。</p>
          <AuthForm mode="login" next={safeNext} />
          <p className="auth-switch">
            还没有账户？ <Link href="/register">注册</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
