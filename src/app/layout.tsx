import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { MotionLayer } from "@/components/motion/MotionLayer";
import { NavProgress } from "@/components/NavProgress";
import { SupportWidget } from "@/components/SupportWidget";
import { VisitBeacon } from "@/components/VisitBeacon";
import { config } from "@/lib/config";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";
import { ShopMascots } from "@/components/shop/ShopMascots";
import "./globals.css";
import "./v2.css";
import "./public.css";

export const metadata: Metadata = {
  metadataBase: new URL(config.appUrl),
  title: {
    default: PUBLIC_API_SALES_ENABLED ? "CokeAI · AI API" : "CokeAI 小店 · 数字商品",
    template: "%s · CokeAI",
  },
  description: PUBLIC_API_SALES_ENABLED
    ? "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。人工审核后发货，订单进度可查。"
    : "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。人工审核后发货，订单进度可查。",
  keywords: PUBLIC_API_SALES_ENABLED
    ? ["CokeAI", "数字商品", "账号", "接码", "订阅充值"]
    : ["CokeAI", "数字商品", "账号", "接码", "订阅充值"],
  authors: [{ name: "CokeAI" }],
  openGraph: {
    title: PUBLIC_API_SALES_ENABLED ? "CokeAI · AI API" : "CokeAI 小店 · 数字商品",
    description: PUBLIC_API_SALES_ENABLED
      ? "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。"
      : "账号、接码与订阅相关商品。人工审核后发货，订单进度可查。",
    type: "website",
    locale: "zh_CN",
    siteName: "CokeAI",
    url: config.appUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: PUBLIC_API_SALES_ENABLED ? "CokeAI · AI API" : "CokeAI 小店 · 数字商品",
    description: PUBLIC_API_SALES_ENABLED
      ? "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。"
      : "账号、接码与订阅相关商品。人工审核后发货，订单进度可查。",
  },
  robots: {
    index: true,
    follow: true,
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f6f3",
  // 刘海屏 / 灵动岛机型：没有这一项，env(safe-area-inset-*) 永远是 0，
  // 底部的购买栏和客服按钮会压在 Home 指示条下面。
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body>
        {children}
        <NavProgress />
        <MotionLayer />
        {/* 桌宠全站挂载：从 /shop 进商品详情也不断档，后台页自己会隐藏。 */}
        <ShopMascots />
        <SupportWidget
          supportEmail={process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd"}
        />
        <VisitBeacon />
      </body>
    </html>
  );
}
