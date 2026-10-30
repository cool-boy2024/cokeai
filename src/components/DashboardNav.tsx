"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  ClipboardList,
  CreditCard,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  PackageSearch,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";

const userItems = [
  { href: "/dashboard", label: "概览", icon: LayoutDashboard },
  { href: "/dashboard/keys", label: "API Key", icon: KeyRound },
  { href: "/dashboard/usage", label: "用量", icon: Activity },
  { href: "/dashboard/billing", label: "充值", icon: CreditCard },
  { href: "/dashboard/shop", label: "我的订单", icon: ShoppingBag },
  { href: "/dashboard/settings", label: "设置", icon: UserRound },
  { href: "/docs", label: "接入教程", icon: BookOpen },
];

const adminItems = [
  { href: "/admin", label: "概览", icon: LayoutDashboard },
  { href: "/admin/orders", label: "订单", icon: ReceiptText },
  { href: "/admin/payments", label: "收款设置", icon: CreditCard },
  { href: "/admin/shop", label: "小店", icon: ShoppingBag },
  { href: "/admin/shop/queue", label: "采购队列", icon: ClipboardList },
  { href: "/admin/shop/sources", label: "货源", icon: PackageSearch },
  { href: "/admin/users", label: "用户", icon: Users },
  { href: "/admin/announcements", label: "公告", icon: Megaphone },
  { href: "/admin/plans", label: "充值包", icon: CreditCard },
  { href: "/admin/pricing", label: "定价", icon: SlidersHorizontal },
  { href: "/admin/gateway", label: "网关", icon: Gauge },
  { href: "/admin/security", label: "安全", icon: ShieldCheck },
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/admin" || href === "/dashboard") return pathname === href;
  // The shop overview owns its product pages; queue and sources have their
  // own nav items and must not light up the overview as well.
  if (href === "/admin/shop") {
    return pathname === href || pathname.startsWith("/admin/shop/products");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname();
  const items = admin ? adminItems : userItems;

  return (
    <nav className="sidebar-nav" aria-label={admin ? "运营导航" : "控制台导航"}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href, pathname);
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
