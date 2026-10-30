import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { MotionLayer } from "@/components/motion/MotionLayer";
import { NavProgress } from "@/components/NavProgress";
import { SupportWidget } from "@/components/SupportWidget";
import { config } from "@/lib/config";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";
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
    ? "兼容 OpenAI SDK 的 AI API 接入服务。人民币按量计费，余额不过期。"
    : "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。人工审核后发货，订单进度可查。",
  keywords: PUBLIC_API_SALES_ENABLED
    ? ["AI API", "OpenAI 兼容", "API 中转", "AI 用量管理", "CokeAI"]
    : ["CokeAI", "数字商品", "账号", "接码", "订阅充值"],
  authors: [{ name: "CokeAI" }],
  openGraph: {
    title: PUBLIC_API_SALES_ENABLED ? "CokeAI · AI API" : "CokeAI 小店 · 数字商品",
    description: PUBLIC_API_SALES_ENABLED
      ? "兼容 OpenAI SDK，人民币按量计费，余额不过期。"
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
      ? "兼容 OpenAI SDK，人民币按量计费，余额不过期。"
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
        <SupportWidget
          supportEmail={process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd"}
        />
      </body>
    </html>
  );
}
