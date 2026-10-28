import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";
import { getCurrentUser } from "@/lib/auth";

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
          <h2>创建账户</h2>
          <p className="auth-sub">注册后充值即可使用，余额不过期。</p>
          <AuthForm mode="register" refCode={refCode} />
          <p className="auth-switch">
            已有账户？ <Link href="/login">登录</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
