import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
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
          <span className="app-topbar-title">CokeAI 运营后台</span>
          <div className="app-topbar-meta">
            <span className="badge badge-red">内部系统</span>
            <span>仅授权人员可访问</span>
            <ShieldCheck size={14} />
          </div>
        </header>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
