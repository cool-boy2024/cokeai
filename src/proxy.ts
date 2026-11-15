import { NextResponse, type NextRequest } from "next/server";
import { config as appConfig } from "@/lib/config";
import { baseUrlFromHeaders } from "@/lib/public-url";
import { fixedWindowLimit, rollingDistinctCount } from "@/lib/rate-limit";
import {
  clientIpFromHeaders,
  isStrictMode,
  isSuspiciousPath,
  recordSecurityEventOnce,
  securityPolicy,
} from "@/lib/security";
import {
  isSearchCrawler,
  legacyShopSlugRedirect,
  shopCrawlLimit,
  shopDetailSlug,
  SHOP_CRAWL_WINDOW_SECONDS,
} from "@/lib/shop-crawl-guard";

/**
 * Application-layer guard.
 *
 * This is the first line that actually sits in production today, because the
 * Cloudflare Tunnel still points at app:3000 rather than edge:8080. It is
 * intentionally cheap: a regex probe check plus Redis counters on sensitive
 * paths only. It never blocks normal browsing and fails open if Redis is down.
 */

type Policy = {
  type: "captcha" | "shop-media" | "shop-api" | "auth-page" | "shop-page" | "shop-dashboard" | "api" | "server-action";
  limit: number;
  windowSeconds: number;
};

const SERVER_ACTION_POLICY: Policy = {
  type: "server-action",
  limit: 60,
  windowSeconds: 60,
};

const POLICIES: Array<{ test: (pathname: string) => boolean; policy: Policy }> = [
  {
    test: (pathname) => pathname === "/api/shop/captcha",
    policy: { type: "captcha", limit: 30, windowSeconds: 60 },
  },
  {
    // Image URLs end in a file extension, so the matcher below currently keeps
    // them out of this middleware. Keep an explicit media budget anyway: if the
    // media URL shape ever changes, a catalogue visit (a page plus 20+ covers)
    // must not be charged against the 120/min API allowance.
    test: (pathname) =>
      pathname.startsWith("/api/shop/images/") ||
      pathname.startsWith("/api/shop/media/"),
    policy: { type: "shop-media", limit: 600, windowSeconds: 60 },
  },
  {
    test: (pathname) => pathname.startsWith("/api/shop/"),
    policy: { type: "shop-api", limit: 120, windowSeconds: 60 },
  },
  {
    test: (pathname) => pathname === "/login" || pathname === "/register",
    policy: { type: "auth-page", limit: 60, windowSeconds: 60 },
  },
  {
    // Public catalogue pages are the most attractive crawl target because
    // supplier-derived copy and links live there. 120/min per IP covers normal
    // browsing while stopping bulk mirroring. Product images have their own
    // media budget above, so one page view does not consume this allowance.
    test: (pathname) => pathname === "/shop" || pathname.startsWith("/shop/"),
    policy: { type: "shop-page", limit: 120, windowSeconds: 60 },
  },
  {
    test: (pathname) => pathname.startsWith("/dashboard/shop"),
    policy: { type: "shop-dashboard", limit: 240, windowSeconds: 60 },
  },
  {
    test: (pathname) =>
      pathname.startsWith("/api/") &&
      pathname !== "/api/health" &&
      !pathname.startsWith("/api/internal/"),
    policy: { type: "api", limit: 240, windowSeconds: 60 },
  },
];

function policyFor(pathname: string): Policy | null {
  return POLICIES.find((entry) => entry.test(pathname))?.policy ?? null;
}

function limitedResponse(request: NextRequest, resetSeconds: number): NextResponse {
  const retryAfter = String(Math.max(1, resetSeconds));
  const wantsJson =
    request.nextUrl.pathname.startsWith("/api/") ||
    request.headers.has("next-action") ||
    (request.headers.get("accept") || "").includes("application/json");

  if (wantsJson) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。" },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": retryAfter,
        },
      },
    );
  }

  return new NextResponse("请求过于频繁，请稍后再试。", {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": retryAfter,
    },
  });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Slugs written before the neutral rename still start with a supplier
  // prefix. Redirect them even when the guard is off: the URL is public data.
  const legacySlug = legacyShopSlugRedirect(pathname);
  if (legacySlug && (request.method === "GET" || request.method === "HEAD")) {
    const base = baseUrlFromHeaders(request.headers, appConfig.appUrl);
    return NextResponse.redirect(
      `${base}${legacySlug}${request.nextUrl.search}`,
      301,
    );
  }

  if (!securityPolicy.guardEnabled) return NextResponse.next();

  const ip = clientIpFromHeaders(request.headers);
  const userAgent = request.headers.get("user-agent") || undefined;

  if (isSuspiciousPath(pathname)) {
    await recordSecurityEventOnce(
      {
        type: "probe",
        ip,
        path: pathname,
        method: request.method,
        detail: "blocked suspicious path",
        ua: userAgent,
      },
      60,
    );
    return new NextResponse("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const strict = await isStrictMode();

  // A scraper can walk every product page inside the per-IP request budget.
  // Count distinct product pages in a rolling minute and stop enumeration long
  // before a full mirror is possible. Search engines stay exempt so indexing
  // keeps working; Redis failures fail open and leave the request budget.
  const slug = shopDetailSlug(pathname);
  if (slug && request.method === "GET" && !isSearchCrawler(userAgent)) {
    const distinct = await rollingDistinctCount(
      `sec:crawl:${ip}`,
      slug,
      SHOP_CRAWL_WINDOW_SECONDS,
    );
    const crawlLimit = shopCrawlLimit(strict);
    if (distinct > crawlLimit) {
      await recordSecurityEventOnce(
        {
          type: "rate_limit",
          ip,
          path: pathname,
          method: request.method,
          detail: `商品页枚举 ${distinct}/${crawlLimit} 个/${SHOP_CRAWL_WINDOW_SECONDS}s`,
          ua: userAgent,
        },
        60,
      );
      return limitedResponse(request, SHOP_CRAWL_WINDOW_SECONDS);
    }
  }

  const isServerAction =
    request.method === "POST" && request.headers.has("next-action");
  const policy = isServerAction ? SERVER_ACTION_POLICY : policyFor(pathname);
  if (!policy) return NextResponse.next();

  const limit = strict ? Math.max(5, Math.floor(policy.limit / 2)) : policy.limit;
  const result = await fixedWindowLimit(
    `sec:rl:${policy.type}:${ip}`,
    limit,
    policy.windowSeconds,
  );

  if (!result.allowed) {
    await recordSecurityEventOnce(
      {
        type: isServerAction ? "server_action" : "rate_limit",
        ip,
        path: pathname,
        method: request.method,
        detail: `${policy.type} ${limit}/${policy.windowSeconds}s${strict ? " strict" : ""}`,
        ua: userAgent,
      },
      60,
    );
    return limitedResponse(request, result.resetSeconds);
  }

  const response = NextResponse.next();
  response.headers.set("x-ratelimit-remaining", String(result.remaining));
  if (strict) response.headers.set("x-security-mode", "strict");
  return response;
}

export const config = {
  matcher: [
    // Run on pages and APIs, skip static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpe?g|webp|avif|svg|ico|woff2?)$).*)",
  ],
};
