/**
 * Bulk-mirroring guard for public product pages.
 *
 * The shop's public pages are the most attractive crawl target: supplier copy,
 * prices and article HTML all live there. This module supplies two rolling
 * counters used by `src/proxy.ts`:
 *
 * - **detail pages** — distinct product slugs per IP, so one IP cannot walk the
 *   whole catalogue inside the request budget;
 * - **list pages** — distinct `/shop?category&q&page` views per IP, so filter
 *   combinations cannot be used to reassemble the catalogue either.
 *
 * Normal browsing (a handful of pages at a time) never reaches either limit,
 * and search engines are exempt so indexing still works.
 */

const SEARCH_CRAWLER_UA =
  /(googlebot|bingbot|baiduspider|yandexbot|applebot|duckduckbot|sogou\s+web\s+spider|360spider|slurp)/i;

/** Static pages under /shop that are not products. */
const NON_PRODUCT_SLUGS = new Set(["terms", "privacy", "refund", "faq"]);

/** Distinct products one IP may open inside the rolling window. */
export const SHOP_CRAWL_LIMIT = 20;
export const SHOP_CRAWL_WINDOW_SECONDS = 60;

/**
 * Distinct /shop list views (category × query × page) one IP may request
 * inside the rolling window. A customer flips through a handful of pages and
 * maybe one category; walking dozens of filter combinations is a mirroring
 * script, not shopping.
 */
export const SHOP_LIST_LIMIT = 20;
export const SHOP_LIST_WINDOW_SECONDS = 60;

/**
 * The list counter is only consulted once the IP has already made this many
 * requests in the window, so ordinary shoppers never pay the extra Redis
 * roundtrip.
 */
export const SHOP_LIST_PROBE_AFTER = 20;

export function shopDetailSlug(pathname: string): string | null {
  const match = pathname.match(/^\/shop\/([a-z0-9][a-z0-9-]{0,119})\/?$/i);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  return NON_PRODUCT_SLUGS.has(slug) ? null : slug;
}

/**
 * Product slugs are public URLs, so they must never carry a supplier prefix.
 * Rows written before 2026-11-15 used `zy-<id>` (and the AI importer produced
 * `auto-<supplier>-...`). The schema migration renames those rows; this map
 * keeps old links and search-engine results working with a permanent redirect
 * to the neutral slug.
 */
const LEGACY_AUTO_SUPPLIER =
  "(?:zyanai|aibijia|aibuji|wzyp|lovecodex|ldxp|kapay|beibei|aisou|talkai|gshh)";

export function legacyShopSlugRedirect(pathname: string): string | null {
  const zy = pathname.match(/^\/shop\/zy-(\d[^/]*?)\/?$/i);
  if (zy) return `/shop/p-${zy[1].toLowerCase()}`;
  const auto = pathname.match(
    new RegExp(`^\\/shop\\/auto-${LEGACY_AUTO_SUPPLIER}-(.+?)\\/?$`, "i"),
  );
  if (auto) return `/shop/auto-${auto[1].toLowerCase()}`;
  return null;
}

export function isSearchCrawler(userAgent: string | undefined): boolean {
  return Boolean(userAgent && SEARCH_CRAWLER_UA.test(userAgent));
}

/**
 * Normalised identity of one catalogue list view. Product pages can be
 * enumerated by page number, but a scraper can also slice the catalogue with
 * category and search filters; each distinct combination counts once. Only
 * `/shop` itself participates — product pages have their own counter.
 */
export function shopListSearchKey(url: URL): string | null {
  if (url.pathname !== "/shop" && url.pathname !== "/shop/") return null;
  const category = (url.searchParams.get("category") || "").trim().toLowerCase();
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const rawPage = (url.searchParams.get("page") || "").trim();
  const page = /^\d{1,6}$/.test(rawPage) ? String(Number(rawPage) || 1) : "1";
  return `${category.slice(0, 40) || "*"}|${query.slice(0, 60) || "*"}|${page}`;
}

export function shopCrawlLimit(strict: boolean): number {
  return strict ? Math.max(8, Math.floor(SHOP_CRAWL_LIMIT / 2)) : SHOP_CRAWL_LIMIT;
}

export function shopListLimit(strict: boolean): number {
  return strict ? Math.max(8, Math.floor(SHOP_LIST_LIMIT / 2)) : SHOP_LIST_LIMIT;
}
