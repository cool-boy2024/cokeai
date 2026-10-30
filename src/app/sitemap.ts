import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const apiPages: MetadataRoute.Sitemap = PUBLIC_API_SALES_ENABLED
    ? [
        {
          url: `${config.appUrl}/pricing`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.8,
        },
        {
          url: `${config.appUrl}/docs`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.7,
        },
      ]
    : [];
  return [
    { url: config.appUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    {
      url: `${config.appUrl}/shop`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...apiPages,
    {
      url: `${config.appUrl}/shop/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${config.appUrl}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${config.appUrl}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
