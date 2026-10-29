import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { MotionLayer } from "@/components/motion/MotionLayer";
import { NavProgress } from "@/components/NavProgress";
import { SupportWidget } from "@/components/SupportWidget";
import { config } from "@/lib/config";
import "./globals.css";
import "./v2.css";
import "./public.css";
import "./taste.css";

export const metadata: Metadata = {
  metadataBase: new URL(config.appUrl),
  title: {
    default: "CokeAI · AI API",
    template: "%s · CokeAI",
  },
  description: "兼容 OpenAI SDK 的 AI API 接入服务。人民币按量计费，余额不过期。",
  keywords: [
    "AI API",
    "OpenAI 兼容",
    "API 中转",
    "DeepSeek API",
    "AI 用量管理",
    "CokeAI",
  ],
  authors: [{ name: "CokeAI" }],
  openGraph: {
    title: "CokeAI · AI API",
    description: "兼容 OpenAI SDK，人民币按量计费，余额不过期。",
    type: "website",
    locale: "zh_CN",
    siteName: "CokeAI",
    url: config.appUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "CokeAI · AI API",
    description: "兼容 OpenAI SDK，人民币按量计费，余额不过期。",
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
  themeColor: "#1c1c1c",
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
