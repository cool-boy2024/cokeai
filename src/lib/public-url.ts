/**
 * Canonical public origin for robots.txt and sitemap.xml.
 *
 * Production runs behind a Cloudflare Tunnel without APP_URL set, so the
 * configured app URL can still be http://localhost:3000. The request carries
 * the real public host in Host / X-Forwarded-Host; prefer it and fall back to
 * the configured URL only for local development.
 */

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function firstHeaderValue(value: string | null): string {
  return value?.split(",")[0]?.trim() || "";
}

export function baseUrlFromHeaders(headers: Headers, fallback: string): string {
  const host =
    firstHeaderValue(headers.get("x-forwarded-host")) ||
    firstHeaderValue(headers.get("host"));
  // The public site is HTTPS-only; behind the tunnel the forwarded proto can
  // be http even though visitors are on TLS, so do not copy it blindly.
  if (host && !LOCAL_HOST.test(host)) return `https://${host}`;
  return fallback.replace(/\/$/, "");
}
