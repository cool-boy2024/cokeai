/**
 * Pure helpers for the first-visit log. Kept free of DB/env imports so the
 * visitor page, the tracking route and scripts/test-visits.ts can share them.
 */

export const VISITOR_COOKIE = "cokeai_vid";
export const VISITOR_RETENTION_DAYS = 30;

const MAX_TEXT = 300;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Client-side visitor id; shared by the beacon and usable in tests. */
export function createVisitorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Full IP stays in the database; only the admin page renders this version. */
export function maskIp(ip: string | null | undefined): string {
  const value = (ip || "").trim();
  if (!value || value === "local" || value === "unknown") return "—";
  if (value.includes(":")) {
    if (value === "::1") return "::1";
    const groups = value.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}:*` : "—";
  }
  const octets = value.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d+$/.test(part))) {
    return `${octets.slice(0, 3).join(".")}.*`;
  }
  return "—";
}

/**
 * Referrer is stored as `host/path` only: query strings can carry tokens or
 * personal data, and the admin only needs to know where the visit came from.
 */
export function sanitizeReferrer(
  raw: string | null | undefined,
  siteHost?: string,
): string {
  const value = (raw || "").trim();
  if (!value) return "直接访问";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "直接访问";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "直接访问";
  if (siteHost && url.host === siteHost) return "站内";
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.host}${path}`.slice(0, MAX_TEXT);
}

export function normalizeLandingPath(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  const path = value.split(/[?#]/, 1)[0].slice(0, MAX_TEXT) || "/";
  // Order numbers must not leak into the visitor log.
  return path
    .replace(/^\/shop\/orders\/[^/]+/, "/shop/orders/:id")
    .replace(/^\/shop\/checkout\/[^/]+/, "/shop/checkout/:id");
}

export function isBotUserAgent(ua: string | null | undefined): boolean {
  const value = (ua || "").trim();
  if (!value) return true;
  return /bot|crawl|spider|slurp|bingpreview|headlesschrome|phantomjs|puppeteer|playwright|curl\/|wget\/|python-requests|go-http-client|okhttp|httpclient|lighthouse|facebookexternalhit|telegrambot/i.test(
    value,
  );
}

export function describeUserAgent(ua: string | null | undefined): string {
  const value = (ua || "").toLowerCase();
  if (!value) return "未知设备";

  const os = /iphone|ipad|ipod/.test(value)
    ? "iOS"
    : /android/.test(value)
      ? "Android"
      : /windows/.test(value)
        ? "Windows"
        : /mac os x|macintosh/.test(value)
          ? "macOS"
          : /linux/.test(value)
            ? "Linux"
            : "未知系统";

  const browser = /edg\//.test(value)
    ? "Edge"
    : /micromessenger/.test(value)
      ? "微信"
      : /chrome|crios/.test(value)
        ? "Chrome"
        : /firefox|fxios/.test(value)
          ? "Firefox"
          : /safari/.test(value)
            ? "Safari"
            : "未知浏览器";

  const mobile = /mobile|iphone|ipad|ipod|android/.test(value);
  return `${os} · ${browser}${mobile ? " · 移动端" : ""}`;
}
