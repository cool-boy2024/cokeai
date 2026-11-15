import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { config } from "@/lib/config";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";
import { baseUrlFromHeaders } from "@/lib/public-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = baseUrlFromHeaders(await headers(), config.appUrl);
  const now = new Date();
  const apiPages: MetadataRoute.Sitemap = PUBLIC_API_SALES_ENABLED
    ? [
        {
          url: `${baseUrl}/pricing`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.8,
        },
        {
          url: `${baseUrl}/docs`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.7,
        },
      ]
    : [];
  return [
    { url: baseUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    {
      url: `${baseUrl}/shop`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...apiPages,
    {
      url: `${baseUrl}/help`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/tools/2fa`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/shop/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
