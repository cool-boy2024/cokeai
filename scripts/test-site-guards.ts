import {
  isSearchCrawler,
  legacyShopSlugRedirect,
  shopCrawlLimit,
  shopDetailSlug,
  shopListLimit,
  shopListSearchKey,
} from "../src/lib/shop-crawl-guard";
import { coarseSold, salesLabel } from "../src/lib/shop/sales-display";
import { isAllowedImageReferer } from "../src/lib/shop/image-referer";
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

assertEqual(shopDetailSlug("/shop/p-46-claude-claude-pro"), "p-46-claude-claude-pro", "plain slug");
assertEqual(shopDetailSlug("/shop/p-46-claude-claude-pro/"), "p-46-claude-claude-pro", "trailing slash");
assertEqual(shopDetailSlug("/shop/P-46-Claude"), "p-46-claude", "case normalised");
assertEqual(shopDetailSlug("/shop"), null, "catalogue is not a product page");
assertEqual(shopDetailSlug("/shop/"), null, "catalogue slash is not a product page");
assertEqual(shopDetailSlug("/shop/terms"), null, "terms is not a product page");
assertEqual(shopDetailSlug("/shop/privacy"), null, "privacy is not a product page");
assertEqual(shopDetailSlug("/shop/refund"), null, "refund is not a product page");
assertEqual(shopDetailSlug("/shop/faq"), null, "faq is not a product page");
assertEqual(shopDetailSlug("/dashboard/shop/p-46"), null, "dashboard is not public");
assertEqual(shopDetailSlug("/shop/p-46/extra"), null, "nested paths are not product pages");

// --- legacy supplier-prefixed slugs ----------------------------------------

assertEqual(
  legacyShopSlugRedirect("/shop/zy-46-claude-claude-pro"),
  "/shop/p-46-claude-claude-pro",
  "old supplier-prefixed slug redirects",
);
assertEqual(
  legacyShopSlugRedirect("/shop/ZY-46-Claude/"),
  "/shop/p-46-claude",
  "old slug redirect is case-insensitive and drops the trailing slash",
);
assertEqual(
  legacyShopSlugRedirect("/shop/auto-zyanai-84-abc123"),
  "/shop/auto-84-abc123",
  "auto slug drops the supplier key",
);
assertEqual(
  legacyShopSlugRedirect("/shop/auto-aibijia-12-deadbe"),
  "/shop/auto-12-deadbe",
  "every known supplier key is dropped",
);
assertEqual(legacyShopSlugRedirect("/shop/p-46"), null, "neutral slug is not redirected");
assertEqual(legacyShopSlugRedirect("/shop"), null, "catalogue is not redirected");
assertEqual(
  legacyShopSlugRedirect("/shop/auto-84-abc123"),
  null,
  "already-neutral auto slug is not redirected",
);

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
assertEqual(shopListLimit(false), 20, "list limit");
assertEqual(shopListLimit(true), 10, "strict list limit");

// --- catalogue view identity ------------------------------------------------

assertEqual(
  shopListSearchKey(new URL("http://x/shop")),
  "*|*|1",
  "bare catalogue is view 1",
);
assertEqual(
  shopListSearchKey(new URL("http://x/shop?page=3")),
  "*|*|3",
  "page number is kept",
);
assertEqual(
  shopListSearchKey(new URL("http://x/shop?page=03&category=Codex&q=%20Pro%20")),
  "codex|pro|3",
  "filters are normalised; page 03 and 3 are the same view",
);
assertEqual(
  shopListSearchKey(new URL("http://x/shop?page=abc")),
  "*|*|1",
  "junk page falls back to 1",
);
assertEqual(
  shopListSearchKey(new URL("http://x/shop/p-46")),
  null,
  "product pages do not use the list counter",
);

// --- coarse storefront labels ----------------------------------------------

assertEqual(coarseSold(0), "0", "small counts stay exact");
assertEqual(coarseSold(9), "9", "small counts stay exact");
assertEqual(coarseSold(12), "10+", "rounds down to tens");
assertEqual(coarseSold(263), "260+", "large counts lose precision");
assertEqual(
  salesLabel({ sold: 263, soldOut: false, remaining: 9, abundant: false }, { coarse: true }),
  "已售 260+ · 仅剩少量",
  "list label is coarse",
);
assertEqual(
  salesLabel({ sold: 263, soldOut: false, remaining: 9, abundant: false }),
  "已售 263 · 库存 9",
  "detail label stays exact",
);

// --- image hotlink allowlist ------------------------------------------------

for (const referer of [
  undefined,
  "",
  "https://cokeai.cc.cd/shop/p-46",
  "https://mp.weixin.qq.com/",
  "https://t.me/somechannel",
  "https://www.google.com/",
  "not a url",
]) {
  assertEqual(isAllowedImageReferer(referer), true, `referer allowed: ${referer || "(empty)"}`);
}

for (const referer of [
  "https://evil.example.com/page",
  "https://evilqq.com/page",
  "https://qq.com.evil.example/page",
]) {
  assertEqual(isAllowedImageReferer(referer), false, `referer blocked: ${referer}`);
}

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
