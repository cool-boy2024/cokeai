import Link from "next/link";
import { ArrowLeft, Home, LogOut, ShoppingBag } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import { Logo } from "./Logo";
import { DashboardNav } from "./DashboardNav";

export function AppSidebar({
  user,
  admin = false,
}: {
  user: SessionUser;
  admin?: boolean;
}) {
  const initial = (user.name || user.email).slice(0, 1).toUpperCase();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <Logo href={admin ? "/admin" : "/dashboard"} />
        {admin ? <span className="badge badge-red">运营</span> : null}
      </div>

      <div className="sidebar-group">
        <div className="sidebar-label">{admin ? "Operations" : "Workspace"}</div>
        <DashboardNav admin={admin} />
      </div>

      {admin ? (
        <div className="sidebar-group">
          <div className="sidebar-label">Switch</div>
          <nav className="sidebar-nav">
            <Link className="sidebar-link" href="/">
              <Home />
              <span>网站首页</span>
            </Link>
            <Link className="sidebar-link" href="/shop">
              <ShoppingBag />
              <span>小店前台</span>
            </Link>
            <Link className="sidebar-link" href="/dashboard">
              <ArrowLeft />
              <span>返回用户控制台</span>
            </Link>
          </nav>
        </div>
      ) : null}

      <div className="sidebar-foot">
        <div className="user-chip">
          <span className="user-avatar">{initial}</span>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <form action={logoutAction}>
          <button className="logout-button" type="submit">
            <LogOut size={14} />
            退出登录
          </button>
        </form>
      </div>
    </aside>
  );
}
