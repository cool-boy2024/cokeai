import {
  isSearchCrawler,
  shopCrawlLimit,
  shopDetailSlug,
} from "../src/lib/shop-crawl-guard";
import { baseUrlFromHeaders } from "../src/lib/public-url";

/**
 * Pure-function checks for the shop crawl guard and the canonical public URL
 * used by robots.txt / sitemap.xml. No database or Redis required:
 * `npm run test:site-guards`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT: ${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

// --- product slug detection -------------------------------------------------

assertEqual(shopDetailSlug("/shop/zy-46-claude-claude-pro"), "zy-46-claude-claude-pro", "plain slug");
assertEqual(shopDetailSlug("/shop/zy-46-claude-claude-pro/"), "zy-46-claude-claude-pro", "trailing slash");
assertEqual(shopDetailSlug("/shop/ZY-46-Claude"), "zy-46-claude", "case normalised");
assertEqual(shopDetailSlug("/shop"), null, "catalogue is not a product page");
assertEqual(shopDetailSlug("/shop/"), null, "catalogue slash is not a product page");
assertEqual(shopDetailSlug("/shop/terms"), null, "terms is not a product page");
assertEqual(shopDetailSlug("/shop/privacy"), null, "privacy is not a product page");
assertEqual(shopDetailSlug("/shop/refund"), null, "refund is not a product page");
assertEqual(shopDetailSlug("/shop/faq"), null, "faq is not a product page");
assertEqual(shopDetailSlug("/dashboard/shop/zy-46"), null, "dashboard is not public");
assertEqual(shopDetailSlug("/shop/zy-46/extra"), null, "nested paths are not product pages");

// --- search crawler exemption ----------------------------------------------

for (const ua of [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)",
  "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
  "Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)",
  "360Spider",
]) {
  assertEqual(isSearchCrawler(ua), true, `crawler allowed: ${ua.slice(0, 40)}`);
}

for (const ua of [
  undefined,
  "",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  "python-requests/2.32.3",
  "Scrapy/2.11 (+https://scrapy.org)",
  "curl/8.7.1",
]) {
  assertEqual(isSearchCrawler(ua), false, `not a search crawler: ${ua ?? "undefined"}`);
}

// --- limits ----------------------------------------------------------------

assertEqual(shopCrawlLimit(false), 20, "normal limit");
assertEqual(shopCrawlLimit(true), 10, "strict halves the limit");

// --- canonical public URL --------------------------------------------------

const headersOf = (values: Record<string, string>) =>
  new Headers(values);

assertEqual(
  baseUrlFromHeaders(
    headersOf({ "x-forwarded-host": "cokeai.cc.cd", host: "app:3000" }),
    "http://localhost:3000",
  ),
  "https://cokeai.cc.cd",
  "prefers forwarded host over internal host",
);
assertEqual(
  baseUrlFromHeaders(
    headersOf({ "x-forwarded-host": "cokeai.cc.cd, internal.lan" }),
    "http://localhost:3000",
  ),
  "https://cokeai.cc.cd",
  "uses the first value of a forwarded list",
);
assertEqual(
  baseUrlFromHeaders(headersOf({ host: "cokeai.cc.cd" }), "http://localhost:3000"),
  "https://cokeai.cc.cd",
  "falls back to Host",
);
assertEqual(
  baseUrlFromHeaders(headersOf({ host: "localhost:3000" }), "http://localhost:3000"),
  "http://localhost:3000",
  "local host keeps the configured fallback",
);
assertEqual(
  baseUrlFromHeaders(headersOf({}), "https://cokeai.cc.cd/"),
  "https://cokeai.cc.cd",
  "missing host uses fallback without trailing slash",
);

console.log("site guards: ok");
