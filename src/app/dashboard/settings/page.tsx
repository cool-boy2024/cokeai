import type { Metadata } from "next";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { PasswordForm } from "@/components/PasswordForm";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatFullDate } from "@/lib/format";

export const metadata: Metadata = { title: "账户设置" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>账户设置</h1>
          <p>管理登录密码与账户基本信息。</p>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>修改密码</h2>
                <p>修改后所有其他登录会话都会失效。</p>
              </div>
              <KeyRound size={17} />
            </div>
            <div className="panel-body">
              <PasswordForm />
            </div>
          </section>

          <div className="notice">
            <ShieldCheck size={16} />
            <div>
              平台不会通过邮件或客服主动索取密码、API Key 或验证码。
              若怀疑账户被入侵，请立即修改密码并在 API Key 页面撤销所有凭证。
            </div>
          </div>
        </div>

        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>账户信息</h2>
                <p>邮箱修改与邮箱验证将在后续接入邮件服务后开放。</p>
              </div>
              <UserRound size={17} />
            </div>
            <div className="panel-body">
              <div className="flex-between mb-12">
                <span className="small muted">昵称</span>
                <strong className="small">{user.name}</strong>
              </div>
              <div className="flex-between mb-12">
                <span className="small muted">邮箱</span>
                <span className="small">{user.email}</span>
              </div>
              <div className="flex-between mb-12">
                <span className="small muted">角色</span>
                <span className={`badge ${user.role === "admin" ? "badge-red" : ""}`}>
                  {user.role === "admin" ? "管理员" : "开发者"}
                </span>
              </div>
              <div className="flex-between mb-12">
                <span className="small muted">注册时间</span>
                <span className="small">{formatDateTime(user.created_at)}</span>
              </div>
              <div className="flex-between">
                <span className="small muted">邀请码</span>
                <span className="mono small">{user.referral_code}</span>
              </div>
              <div className="divider" />
              <div className="flex-between">
                <span className="small muted">当前套餐</span>
                <span className="small">
                  {user.plan_active ? user.plan_name : "未激活"}
                </span>
              </div>
              <div className="flex-between mt-8">
                <span className="small muted">套餐到期</span>
                <span className="small">
                  {user.plan_expires_at ? formatFullDate(user.plan_expires_at) : "—"}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
