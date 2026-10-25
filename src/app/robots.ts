import type { MetadataRoute } from "next";
import { config } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/admin", "/api", "/login", "/register"],
      },
    ],
    sitemap: `${config.appUrl}/sitemap.xml`,
    host: config.appUrl,
  };
}
