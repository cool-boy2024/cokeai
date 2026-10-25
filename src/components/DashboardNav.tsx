"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CreditCard,
  Gift,
  KeyRound,
  LayoutDashboard,
  ReceiptText,
  Server,
  Settings,
  UserRound,
  Users,
} from "lucide-react";

const userItems = [
  { href: "/dashboard", label: "概览", icon: LayoutDashboard },
  { href: "/dashboard/keys", label: "API Key", icon: KeyRound },
  { href: "/dashboard/usage", label: "用量账单", icon: Activity },
  { href: "/dashboard/billing", label: "套餐与订单", icon: CreditCard },
  { href: "/dashboard/referrals", label: "推荐奖励", icon: Gift },
  { href: "/dashboard/settings", label: "账户设置", icon: UserRound },
];

const adminItems = [
  { href: "/admin", label: "运营概览", icon: LayoutDashboard },
  { href: "/admin/orders", label: "订单", icon: ReceiptText },
  { href: "/admin/users", label: "用户", icon: Users },
  { href: "/admin/models", label: "模型与上游", icon: Server },
  { href: "/admin/plans", label: "套餐", icon: Settings },
];

export function DashboardNav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname();
  const items = admin ? adminItems : userItems;

  return (
    <nav className="sidebar-nav" aria-label={admin ? "运营导航" : "控制台导航"}>
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/admin" || item.href === "/dashboard"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link${active ? " active" : ""}`}
          >
            <Icon />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
