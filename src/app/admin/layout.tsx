import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard, LogOut, ShoppingBag } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { countUnreadMessagesForAdmin } from "@/lib/support";
import { countNewSignups24h } from "@/lib/visits";
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

  // Counts that stay in reach from every admin page: paid orders still need a
  // trip to the supplier, unpaid ones need watching before they expire, and
  // reported payments are waiting for a human to check the bank record.
  const counts = await query<{ pending: string; to_buy: string; reported: string }>(
    `SELECT COUNT(*) FILTER (
              WHERE status = 'pending_payment' AND expires_at > now()
            )::text AS pending,
            COUNT(*) FILTER (WHERE status IN ('paid', 'procuring'))::text AS to_buy,
            COUNT(*) FILTER (
              WHERE status = 'pending_payment' AND EXISTS (
                SELECT 1 FROM manual_alipay_payments p
                 WHERE p.order_id = shop_orders.id
                   AND p.order_kind = 'shop'
                   AND p.reported_at IS NOT NULL
              )
            )::text AS reported
       FROM shop_orders`,
  );
  const shopCounts = counts.rows[0];
  const [unreadTickets, newSignups] = await Promise.all([
    countUnreadMessagesForAdmin(),
    countNewSignups24h(),
  ]);

  return (
    <div className="app-shell">
      <AppSidebar
        user={user}
        admin
        badges={{
          "/admin/shop/orders": Number(shopCounts?.reported || 0),
          "/admin/shop": Number(shopCounts?.pending || 0),
          "/admin/shop/queue": Number(shopCounts?.to_buy || 0),
          "/admin/support": unreadTickets,
          "/admin/visitors": newSignups,
        }}
      />
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
