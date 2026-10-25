import type { Metadata, Viewport } from "next";
import { config } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(config.appUrl),
  title: {
    default: "CokeAI · 可预算的 AI API 接入平台",
    template: "%s · CokeAI",
  },
  description:
    "一个 API Key 接入多家授权 AI 模型，提供人民币计费、硬预算、实时用量和开发者控制台。兼容 OpenAI SDK。",
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
    title: "CokeAI · 可预算的 AI API 接入平台",
    description:
      "一个 Key，接入多家授权模型。透明计费、硬预算、OpenAI SDK 兼容。",
    type: "website",
    locale: "zh_CN",
    siteName: "CokeAI",
    url: config.appUrl,
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
  themeColor: "#f4efe5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
