import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
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
    <div className="auth-page">
      <aside className="auth-aside">
        <Logo />
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            Developer workspace
          </div>
          <h1>你的用量、额度和 API，都在一个地方。</h1>
          <p>
            登录后查看余额、创建项目 Key、追踪每个模型的真实花费，并管理套餐与推荐奖励。
          </p>
        </div>
        <div className="auth-aside-meta">
          <div>OPENAI-COMPATIBLE API GATEWAY</div>
          <div>Hard budgets · Transparent metering · No prompt storage</div>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <Link className="text-link small" href="/">
            <span className="vertical-align">
              <ArrowLeft size={13} /> 返回首页
            </span>
          </Link>
          <h2>欢迎回来。</h2>
          <p className="auth-sub">登录继续管理你的 AI API 用量。</p>
          <AuthForm mode="login" next={safeNext} />
          <p className="auth-switch">
            还没有账户？ <Link href="/register">免费注册</Link>
          </p>
          <div className="form-success mt-24">
            <span className="vertical-align">
              <Check size={13} /> 平台不会索取你的模型账号密码或个人订阅凭据。
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
