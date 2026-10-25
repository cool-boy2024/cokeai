import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
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

  return (
    <div className="app-shell">
      <AppSidebar user={user} />
      <main className="app-main">
        <header className="app-topbar">
          <span className="app-topbar-title">开发者控制台</span>
          <div className="app-topbar-meta">
            <span className="mono">余额 {formatCny(user.balance_micros)}</span>
            <span
              className={`badge ${
                user.plan_active ? "badge-green badge-dot" : "badge-yellow"
              }`}
            >
              {user.plan_active ? user.plan_name || "套餐生效中" : "未激活套餐"}
            </span>
            <Link
              href="/docs"
              className="vertical-align"
              style={{ color: "var(--muted)", fontSize: 11 }}
            >
              <BookOpen size={13} /> 文档
            </Link>
            {user.role === "admin" ? (
              <Link
                href="/admin"
                className="vertical-align"
                style={{ color: "var(--red-deep)", fontSize: 11 }}
              >
                <ExternalLink size={13} /> 运营后台
              </Link>
            ) : null}
          </div>
        </header>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
