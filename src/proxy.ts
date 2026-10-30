import { NextResponse, type NextRequest } from "next/server";
import { fixedWindowLimit } from "@/lib/rate-limit";
import {
  clientIpFromHeaders,
  isStrictMode,
  isSuspiciousPath,
  recordSecurityEventOnce,
  securityPolicy,
} from "@/lib/security";

/**
 * Application-layer guard.
 *
 * This is the first line that actually sits in production today, because the
 * Cloudflare Tunnel still points at app:3000 rather than edge:8080. It is
 * intentionally cheap: a regex probe check plus Redis counters on sensitive
 * paths only. It never blocks normal browsing and fails open if Redis is down.
 */

type Policy = {
  type: "captcha" | "shop-api" | "auth-page" | "shop-page" | "shop-dashboard" | "api" | "server-action";
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
    test: (pathname) => pathname.startsWith("/api/shop/"),
    policy: { type: "shop-api", limit: 120, windowSeconds: 60 },
  },
  {
    test: (pathname) => pathname === "/login" || pathname === "/register",
    policy: { type: "auth-page", limit: 60, windowSeconds: 60 },
  },
  {
    test: (pathname) => pathname === "/shop" || pathname.startsWith("/shop/"),
    policy: { type: "shop-page", limit: 600, windowSeconds: 60 },
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
  if (!securityPolicy.guardEnabled) return NextResponse.next();

  const { pathname } = request.nextUrl;
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

  const isServerAction =
    request.method === "POST" && request.headers.has("next-action");
  const policy = isServerAction ? SERVER_ACTION_POLICY : policyFor(pathname);
  if (!policy) return NextResponse.next();

  const strict = await isStrictMode();
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
