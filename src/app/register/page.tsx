import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
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
    <div className="auth-page">
      <aside className="auth-aside">
        <Logo />
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            Start with clarity
          </div>
          <h1>先理解成本，再放大 AI 能力。</h1>
          <p>
            注册不收取费用。选择套餐后才产生费用，所有额度、有效期和模型价格都会写清楚。
          </p>
        </div>
        <div className="auth-aside-meta">
          <div>NO UNLIMITED CLAIMS · NO VIRTUAL DOLLARS</div>
          <div>Only authorized upstream APIs · RMB metering</div>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <Link className="text-link small" href="/">
            <span className="vertical-align">
              <ArrowLeft size={13} /> 返回首页
            </span>
          </Link>
          <h2>创建开发者账户。</h2>
          <p className="auth-sub">几分钟内完成接入，从真实调用开始验证。</p>
          <AuthForm mode="register" refCode={refCode} />
          <p className="auth-switch">
            已有账户？ <Link href="/login">直接登录</Link>
          </p>
          <div className="form-success mt-24">
            <span className="vertical-align">
              <Check size={13} /> 注册后必须购买有效套餐才能调用模型 API。
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
