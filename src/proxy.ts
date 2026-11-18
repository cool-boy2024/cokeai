import { NextResponse, type NextRequest } from "next/server";
import { config as appConfig } from "@/lib/config";
import { baseUrlFromHeaders } from "@/lib/public-url";
import { fixedWindowLimit, rollingDistinctCount } from "@/lib/rate-limit";
import {
  clientIpFromHeaders,
  isStrictMode,
  isSuspiciousPath,
  isTrustedAdminIp,
  PUBLIC_ATTACK_NOTICE,
  recordSecurityEventOnce,
  securityPolicy,
} from "@/lib/security";
import {
  isSearchCrawler,
  legacyShopSlugRedirect,
  shopCrawlLimit,
  shopDetailSlug,
  shopListLimit,
  shopListSearchKey,
  SHOP_CRAWL_WINDOW_SECONDS,
  SHOP_LIST_PROBE_AFTER,
  SHOP_LIST_WINDOW_SECONDS,
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
  type: "captcha" | "shop-media" | "shop-api" | "auth-page" | "shop-list" | "shop-page" | "shop-dashboard" | "api" | "server-action";
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
    // The catalogue list is the cheapest way to mirror the whole shop: names,
    // prices, stock labels and cover URLs are all in one HTML response. 60/min
    // per IP is far above human clicking (a visitor loads one list page and a
    // handful of products); product images have their own media budget above.
    test: (pathname) => pathname === "/shop" || pathname === "/shop/",
    policy: { type: "shop-list", limit: 60, windowSeconds: 60 },
  },
  {
    // Product detail pages are the most attractive crawl target because
    // supplier-derived copy and links live there. 120/min per IP covers normal
    // browsing while the distinct-slug counter below stops bulk mirroring.
    test: (pathname) => pathname.startsWith("/shop/"),
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

/**
 * Friendly page for a customer who is being throttled during an attack. It
 * auto-refreshes when the window resets and reassures the buyer that orders
 * and payments are preserved. No counters or defense details are exposed.
 */
function limitedPageHtml(resetSeconds: number): string {
  const wait = Math.max(1, resetSeconds);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="${wait}">
<title>访问暂时受限 · CokeAI</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; background: #f7f6f3; color: #1c1a17;
    font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Microsoft YaHei", sans-serif;
  }
  main {
    width: min(520px, 100%); padding: 32px; background: #fff;
    border: 1px solid #e4dfd4; border-radius: 16px;
    box-shadow: 0 20px 50px rgba(28, 26, 23, 0.08);
  }
  span {
    display: inline-block; margin-bottom: 14px; padding: 3px 10px;
    border-radius: 999px; background: #7a3b1e; color: #fff;
    font-size: 12px; letter-spacing: 0.08em;
  }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.3; }
  p { margin: 0 0 12px; color: #56514a; }
  .actions { display: flex; gap: 12px; margin-top: 20px; }
  a {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 40px; padding: 0 18px; border-radius: 999px;
    background: #1c1a17; color: #fff; text-decoration: none; font-size: 14px;
  }
  a.secondary { background: #fff; color: #1c1a17; border: 1px solid #d8d2c6; }
</style>
</head>
<body>
<main>
  <span>临时保护中</span>
  <h1>访问暂时受限</h1>
  <p>${PUBLIC_ATTACK_NOTICE}</p>
  <p>本页会在约 ${wait} 秒后自动刷新。请不要重复提交订单或付款。</p>
  <div class="actions">
    <a href="">刷新重试</a>
    <a class="secondary" href="/">返回首页</a>
  </div>
</main>
</body>
</html>`;
}

function limitedResponse(request: NextRequest, resetSeconds: number): NextResponse {
  const retryAfter = String(Math.max(1, resetSeconds));
  const wantsJson =
    request.nextUrl.pathname.startsWith("/api/") ||
    request.headers.has("next-action") ||
    (request.headers.get("accept") || "").includes("application/json");

  if (wantsJson) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。", notice: PUBLIC_ATTACK_NOTICE },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": retryAfter,
        },
      },
    );
  }

  return new NextResponse(limitedPageHtml(Math.max(1, resetSeconds)), {
    status: 429,
    headers: {
      "content-type": "text/html; charset=utf-8",
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
    if (distinct > crawlLimit && !(await isTrustedAdminIp(ip))) {
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
    // An operator IP that completed an admin login (or is listed in
    // SECURITY_ADMIN_IPS) must stay able to open the console and log in while
    // an attack keeps ordinary IPs throttled.
    if (await isTrustedAdminIp(ip)) {
      return NextResponse.next();
    }
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

  // The list budget alone still lets one IP walk every page/filter combination
  // slowly. Count distinct list views per IP in a rolling minute and stop
  // filter-based reassembly of the catalogue. Only consulted after a burst of
  // requests, so an ordinary shopper never pays the extra Redis call.
  if (
    policy.type === "shop-list" &&
    request.method === "GET" &&
    !isSearchCrawler(userAgent) &&
    limit - result.remaining >= SHOP_LIST_PROBE_AFTER
  ) {
    const listKey = shopListSearchKey(request.nextUrl);
    if (listKey) {
      const distinct = await rollingDistinctCount(
        `sec:crawl:list:${ip}`,
        listKey,
        SHOP_LIST_WINDOW_SECONDS,
      );
      const listLimit = shopListLimit(strict);
      if (distinct > listLimit && !(await isTrustedAdminIp(ip))) {
        await recordSecurityEventOnce(
          {
            type: "rate_limit",
            ip,
            path: pathname,
            method: request.method,
            detail: `列表页枚举 ${distinct}/${listLimit} 个/${SHOP_LIST_WINDOW_SECONDS}s`,
            ua: userAgent,
          },
          60,
        );
        return limitedResponse(request, SHOP_LIST_WINDOW_SECONDS);
      }
    }
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
