import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, LogOut, Plus } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { getGatewayBalanceForRequest } from "@/lib/gateway-credits";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = {
  title: "控制台",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const liveBalance = await getGatewayBalanceForRequest(user.id).catch(() => ({
    balance: user.balance_micros / 1_000_000,
  }));

  return (
    <div className="app-shell">
      <AppSidebar user={user} />
      <main className="app-main">
        <header className="app-topbar">
          <span className="app-topbar-title">控制台</span>
          <div className="app-topbar-meta">
            <span className="mono">余额 {formatCny(liveBalance.balance * 1_000_000)}</span>
            <Link className="btn btn-primary btn-sm" href="/dashboard/billing">
              <Plus size={13} /> 充值
            </Link>
            {user.role === "admin" ? (
              <Link href="/admin" className="topbar-link">
                <ExternalLink size={13} /> 运营后台
              </Link>
            ) : null}
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
