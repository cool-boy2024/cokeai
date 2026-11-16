import {
  countryLabel,
  createVisitorId,
  describeUserAgent,
  formatLocation,
  isBotUserAgent,
  isVisitorId,
  maskIp,
  normalizeGeoText,
  normalizeLandingPath,
  sanitizeReferrer,
} from "../src/lib/visits-format";

/**
 * Pure-function checks for the first-visit log. No database required:
 * `npm run test:visits`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT: ${message} (expected ${expected}, got ${actual})`);
  }
}

// IP masking: full value stays in the database, the admin only sees this.
assertEqual(maskIp("1.2.3.4"), "1.2.3.*", "IPv4 masks the last octet");
assertEqual(maskIp("203.0.113.9"), "203.0.113.*", "IPv4 second sample");
assertEqual(
  maskIp("2001:db8:85a3:0:0:8a2e:370:7334"),
  "2001:db8:85a3:*",
  "IPv6 keeps three groups",
);
assertEqual(maskIp("::1"), "::1", "loopback stays readable");
assertEqual(maskIp("local"), "—", "local sentinel");
assertEqual(maskIp(""), "—", "empty IP");
assertEqual(maskIp("not-an-ip"), "—", "garbage IP");

// Referrer: host + path only; query strings can carry tokens.
assertEqual(
  sanitizeReferrer("https://www.google.com/search?q=secret#frag", "cokeai.cc.cd"),
  "www.google.com/search",
  "referrer drops query and hash",
);
assertEqual(
  sanitizeReferrer("https://cokeai.cc.cd/shop", "cokeai.cc.cd"),
  "站内",
  "same-site referrer",
);
assertEqual(sanitizeReferrer("https://www.bing.com/", "cokeai.cc.cd"), "www.bing.com", "root path");
assertEqual(sanitizeReferrer(""), "直接访问", "empty referrer");
assertEqual(sanitizeReferrer("not a url"), "直接访问", "unparseable referrer");
assertEqual(sanitizeReferrer("javascript:alert(1)"), "直接访问", "non-http scheme");

// Landing path: strip query and never store order numbers.
assertEqual(
  normalizeLandingPath("/shop/orders/CK20261027ACEC06A1"),
  "/shop/orders/:id",
  "order number normalized",
);
assertEqual(
  normalizeLandingPath("/shop/checkout/CK123?from=mail"),
  "/shop/checkout/:id",
  "checkout order number normalized",
);
assertEqual(
  normalizeLandingPath("/shop/chatgpt-plus?ref=ad"),
  "/shop/chatgpt-plus",
  "query stripped",
);
assertEqual(normalizeLandingPath("https://evil.example/x"), "/", "absolute URL rejected");
assertEqual(normalizeLandingPath("//evil.example"), "/", "protocol-relative rejected");
assertEqual(normalizeLandingPath(""), "/", "empty path");

// Device labels.
assertEqual(
  describeUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  ),
  "iOS · Safari · 移动端",
  "iPhone Safari",
);
assertEqual(
  describeUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  ),
  "Windows · Chrome",
  "Windows Chrome",
);
assertEqual(describeUserAgent(""), "未知设备", "empty user agent");

// Bot filter.
assertEqual(
  isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
  true,
  "Googlebot",
);
assertEqual(isBotUserAgent("curl/8.5.0"), true, "curl");
assertEqual(isBotUserAgent("python-requests/2.31"), true, "python-requests");
assertEqual(isBotUserAgent(""), true, "missing UA");
assertEqual(
  isBotUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
  ),
  false,
  "normal browser",
);

// Client-generated ids must pass the server-side UUID check.
assertEqual(isVisitorId(createVisitorId()), true, "generated visitor id is a UUID");
assertEqual(isVisitorId("not-a-uuid"), false, "rejects malformed id");

// Location: Cloudflare headers are untrusted text, so they get normalized.
assertEqual(normalizeGeoText("  Henan  "), "Henan", "trims whitespace");
assertEqual(normalizeGeoText("Henan%20Sheng"), "Henan Sheng", "decodes percent-encoding");
assertEqual(normalizeGeoText("%E6%B2%B3%E5%8D%97"), "河南", "decodes UTF-8 location names");
assertEqual(normalizeGeoText("A%ZZ"), "A%ZZ", "malformed escape is kept verbatim");
assertEqual(normalizeGeoText("A\tB"), "A B", "control chars become a space");
assertEqual(
  normalizeGeoText("a\u0000b\u001fc"),
  "a b c",
  "control chars never glue words",
);
assertEqual(normalizeGeoText(null), "", "missing header");
assertEqual(normalizeGeoText("x".repeat(200)).length, 60, "caps long values");
assertEqual(Array.from(normalizeGeoText("🀄".repeat(80))).length, 60, "caps by code point");

assertEqual(countryLabel("CN"), "中国", "mainland China");
assertEqual(countryLabel("cn"), "中国", "country codes are case-insensitive");
assertEqual(countryLabel("HK"), "中国香港", "Hong Kong");
assertEqual(countryLabel("TW"), "中国台湾", "Taiwan");
assertEqual(countryLabel("XX"), "", "XX means undeterminable");
assertEqual(countryLabel("T1"), "", "T1 means Tor");
assertEqual(countryLabel("ZZ"), "ZZ", "unknown codes stay readable");
assertEqual(countryLabel(""), "", "empty country");

assertEqual(
  formatLocation("CN", "Henan", "Zhengzhou"),
  "中国 · Henan · Zhengzhou",
  "country, region and city",
);
assertEqual(formatLocation("CN", "", ""), "中国", "country only");
assertEqual(formatLocation("", "", ""), "—", "nothing known");
assertEqual(formatLocation("XX", "Henan", ""), "Henan", "undeterminable country is dropped");

console.log("visits tests ok");
