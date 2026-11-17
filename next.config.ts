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
    // Server Actions cap request bodies at 1MB by default. Support tickets
    // accept 3 images and payment claims 2, each up to 5MB — 20MB covers the
    // larger form plus multipart overhead.
    serverActions: {
      bodySizeLimit: "20mb",
    },
    // Keep recently visited console pages in the client router cache so
    // sidebar navigation does not wait on a slow round trip every time.
    staleTimes: { dynamic: 15 },
    dynamicOnHover: true,
    // Only offer security-patch upgrades from the in-app update nudge, so
    // "next upgrade" never pulls a major release into the running storefront.
    agentUpgrade: "security",
  },
  async redirects() {
    // The customer console no longer exposes API key or usage pages. Keep old
    // bookmarks and inbound links working instead of returning a 404.
    return [
      {
        source: "/dashboard/keys",
        destination: "/dashboard",
        permanent: false,
      },
      {
        source: "/dashboard/usage",
        destination: "/dashboard",
        permanent: false,
      },
    ];
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
            // Enforced policy. The site self-hosts fonts, icons and media;
            // the inline allowances are still required by the Next.js
            // bootstrap and style injection. Violations are collected at
            // /api/csp-report, so any further tightening can be data-driven.
            key: "Content-Security-Policy",
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
              "report-uri /api/csp-report",
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
      // Mirrored tutorial clips are content-addressed too. Range requests
      // from the <video> element must not be revalidated on every seek.
      {
        source: "/api/shop/media/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
