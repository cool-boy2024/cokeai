/**
 * Bulk-mirroring guard for public product pages.
 *
 * The shop's public pages are the most attractive crawl target: supplier copy,
 * prices and article HTML all live there. A single IP can fetch every product
 * within the existing 120/min budget, so this guard counts *distinct product
 * pages* per IP in a rolling minute and stops enumeration well before a full
 * mirror is possible. Normal browsing (a handful of products at a time) never
 * reaches the limit, and search engines are exempt so indexing still works.
 */

const SEARCH_CRAWLER_UA =
  /(googlebot|bingbot|baiduspider|yandexbot|applebot|duckduckbot|sogou\s+web\s+spider|360spider|slurp)/i;

/** Static pages under /shop that are not products. */
const NON_PRODUCT_SLUGS = new Set(["terms", "privacy", "refund", "faq"]);

/** Distinct products one IP may open inside the rolling window. */
export const SHOP_CRAWL_LIMIT = 20;
export const SHOP_CRAWL_WINDOW_SECONDS = 60;

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

export function shopCrawlLimit(strict: boolean): number {
  return strict ? Math.max(8, Math.floor(SHOP_CRAWL_LIMIT / 2)) : SHOP_CRAWL_LIMIT;
}
