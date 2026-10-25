import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CokeAI · 可预算的 AI API",
    short_name: "CokeAI",
    description: "OpenAI 兼容的 AI API 接入、预算与用量管理平台。",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f4efe5",
    theme_color: "#e44232",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
