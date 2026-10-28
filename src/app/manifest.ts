import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CokeAI · 可预算的 AI API",
    short_name: "CokeAI",
    description: "OpenAI 兼容的 AI API 接入、预算与用量管理平台。",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#161615",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
