import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { config } from "@/lib/config";
import { baseUrlFromHeaders } from "@/lib/public-url";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = baseUrlFromHeaders(await headers(), config.appUrl);
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/admin", "/api", "/login", "/register"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
