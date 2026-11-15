import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { SESSION_COOKIE } from "@/lib/auth";
import { clientIpFromHeaders } from "@/lib/security";
import { fixedWindowLimit } from "@/lib/rate-limit";
import {
  isBotUserAgent,
  isVisitorId,
  normalizeLandingPath,
  sanitizeReferrer,
  VISITOR_COOKIE,
  VISITOR_RETENTION_DAYS,
} from "@/lib/visits-format";
import { purgeSiteVisits, recordFirstVisit } from "@/lib/visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;
const IP_DAILY_LIMIT = 30;

function reply(visitorId?: string): NextResponse {
  const response = new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
  if (visitorId) {
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: false,
      secure: config.appUrl.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: VISITOR_RETENTION_DAYS * 24 * 60 * 60,
    });
  }
  return response;
}

/**
 * Anonymous first-visit sink. The browser sends a self-generated visitor id
 * once, before login; the registration flow links that id to the new account.
 * Logged-in requests are ignored on purpose — the console is not "traffic".
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (cookieStore.get(VISITOR_COOKIE)) return reply();

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host")) return reply();
    } catch {
      return reply();
    }
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return reply();

  const raw = (await request.text()).slice(0, MAX_BODY_BYTES);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return reply();
  }

  const visitorId = payload.visitorId;
  if (!isVisitorId(visitorId)) return reply();

  // Logged-in browsers are not "traffic"; still set the cookie so the beacon
  // stops sending on every public page.
  if (cookieStore.get(SESSION_COOKIE)) return reply(visitorId);

  const ip = clientIpFromHeaders(request.headers);
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 300);

  // Bots that do run JS (headless CI, crawler sandboxes) otherwise inflate the
  // "new visitors" number. Cookie is still set so they stop retrying.
  if (isBotUserAgent(userAgent)) return reply(visitorId);

  const limit = await fixedWindowLimit(`visit:ip:${ip}`, IP_DAILY_LIMIT, 24 * 60 * 60);
  if (!limit.allowed) return reply(visitorId);

  const siteHost = new URL(config.appUrl).host;
  try {
    await recordFirstVisit({
      visitorId,
      ip,
      userAgent,
      referrer: sanitizeReferrer(String(payload.referrer || ""), siteHost),
      landingPath: normalizeLandingPath(String(payload.landingPath || "")),
    });
    await purgeSiteVisits();
  } catch (error) {
    console.error("[visits] record failed:", (error as Error).message);
  }

  return reply(visitorId);
}
