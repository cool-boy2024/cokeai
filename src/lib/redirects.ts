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
