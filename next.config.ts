import type { NextConfig } from "next";

// Internal surfaces must never be indexed or cached by shared proxies. The
// robots.txt disallow is advisory; these headers apply even to crawlers that
// ignore robots.txt, and keep authenticated HTML out of intermediary caches.
const NO_INDEX_HEADERS = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "ioredis"],
  experimental: {
    // Keep recently visited console pages in the client router cache so
    // sidebar navigation does not wait on a slow round trip every time.
    staleTimes: { dynamic: 15 },
    dynamicOnHover: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            // Report-Only first: it records violations without breaking the
            // inline bootstrap scripts and payment redirects. Promote to an
            // enforcing CSP after the report stream stays clean.
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self' https:",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "media-src 'self' blob: https:",
              "connect-src 'self' https: wss:",
              "frame-src 'self' https:",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
      // Admin console, user console and every API response: no indexing and
      // no shared caching. Add the bare paths too so /admin, /api and
      // /dashboard themselves are covered on every Next.js version.
      {
        source: "/admin",
        headers: NO_INDEX_HEADERS,
      },
      {
        source: "/admin/:path*",
        headers: NO_INDEX_HEADERS,
      },
      {
        source: "/dashboard",
        headers: NO_INDEX_HEADERS,
      },
      {
        source: "/dashboard/:path*",
        headers: NO_INDEX_HEADERS,
      },
      {
        source: "/api",
        headers: NO_INDEX_HEADERS,
      },
      {
        source: "/api/:path*",
        headers: NO_INDEX_HEADERS,
      },
      // Content-addressed shop images are not sensitive and are requested in
      // bursts when a product page opens. Keep their immutable caching; only
      // the noindex header is inherited. This rule must stay after the generic
      // /api rule so it wins for the same header key.
      {
        source: "/api/shop/images/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
