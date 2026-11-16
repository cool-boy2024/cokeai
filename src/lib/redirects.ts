/**
 * Validates a post-login `next` value.
 *
 * Only same-origin, path-absolute URLs are allowed. Browsers normalise
 * backslashes to slashes for special schemes, so `/\evil.com` is as dangerous
 * as `//evil.com`; both are rejected. Control characters and scheme-relative
 * forms are rejected as well, and the final value is rebuilt from the parsed
 * URL so an encoded separator cannot survive.
 */
export function safeNextPath(value: string | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  const raw = value.trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return fallback;
  }

  try {
    const base = "https://cokeai.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Builds a /login or /register link that survives the login ⇄ register switch.
 *
 * Without this, a guest who clicks 购买 on a product lands on
 * /login?next=/shop/x, then taps 注册 and loses `next`, so they finish signup
 * at the dashboard instead of back on the product they wanted to buy.
 *
 * `next` is re-validated here rather than trusted from the caller, so the auth
 * pages can never be used to launder an open redirect.
 */
export function authHref(
  path: "/login" | "/register",
  options: { next?: string; ref?: string } = {},
): string {
  const params = new URLSearchParams();
  const next = options.next ? safeNextPath(options.next, "") : "";
  if (next) params.set("next", next);
  const ref = (options.ref || "").trim().toUpperCase().slice(0, 32);
  if (ref) params.set("ref", ref);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
