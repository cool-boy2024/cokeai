/**
 * HTML-to-text helpers shared by the supplier importer and the standalone
 * mirror scripts. Kept free of database and zod imports so it can be bundled
 * into a small Node script for production maintenance.
 */

function decodeEntities(input: string): string {
  const codePoint = (raw: string, radix: number): string => {
    const value = Number.parseInt(raw, radix);
    if (!Number.isFinite(value) || value < 1 || value > 0x10ffff) return "";
    return String.fromCodePoint(value);
  };
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(code, 16));
}

/** Very small readability pass: drop non-content tags, keep line breaks. */
export function extractReadableText(html: string, maxChars = 12_000): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 1)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}
