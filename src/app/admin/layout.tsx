import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard, LogOut, ShoppingBag } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { requireAdmin } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";

export const metadata: Metadata = {
  title: "运营后台",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="app-shell">
      <AppSidebar user={user} admin />
      <main className="app-main">
        <header className="app-topbar">
          <span className="app-topbar-title">运营后台</span>
          <div className="app-topbar-meta">
            <Link className="btn btn-light btn-sm" href="/">
              <ArrowLeft size={14} /> 返回网站
            </Link>
            <Link href="/shop" className="topbar-link">
              <ShoppingBag size={13} /> 小店前台
            </Link>
            <Link href="/dashboard" className="topbar-link">
              <LayoutDashboard size={13} /> 用户控制台
            </Link>
            <span className="badge badge-dark">内部</span>
            <form action={logoutAction}>
              <button
                className="topbar-logout"
                type="submit"
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={13} /> <span>退出</span>
              </button>
            </form>
          </div>
        </header>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
