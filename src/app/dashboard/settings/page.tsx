import type { Metadata } from "next";
import { KeyRound, UserRound } from "lucide-react";
import { PasswordForm } from "@/components/PasswordForm";
import { MascotPrefToggle } from "@/components/shop/MascotPrefToggle";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "设置" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>账户信息与密码。</p>
        </div>
      </div>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>修改密码</h2>
              <p>修改后其他设备会退出登录。</p>
            </div>
            <KeyRound size={17} />
          </div>
          <div className="panel-body">
            <PasswordForm />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>账户</h2>
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
            <div className="flex-between">
              <span className="small muted">注册时间</span>
              <span className="small">{formatDateTime(user.created_at)}</span>
            </div>
            <div className="mt-16">
              <MascotPrefToggle />
              <p className="small muted mt-8">关掉后，电脑上的公开页面不再显示三只桌宠。</p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
