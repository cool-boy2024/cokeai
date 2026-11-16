import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CokeAI · 可预算的 AI API",
    short_name: "CokeAI",
    description: "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#161615",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
