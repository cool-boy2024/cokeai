import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  MagnifyingGlass,
  Package,
  Question,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Pagination } from "@/components/Pagination";
import { ProductCard } from "@/components/shop/ProductCard";
import { ProductRow } from "@/components/shop/ProductRow";
import { RecentSidebar } from "@/components/shop/RecentSidebar";
import { ShopMascots } from "@/components/shop/ShopMascots";
import { ShopFeaturedCard } from "@/components/shop/ShopFeaturedCard";
import { AvailabilityLegend } from "@/components/shop/ShopBadges";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  listPublicProducts,
  listRecentPublicProducts,
  startingPriceMicros,
  type PublicShopProduct,
} from "@/lib/shop/catalog";
import { applyMemberPricing } from "@/lib/shop/member-pricing";
import {
  filterProductsByCategory,
  isShopCategorySlug,
  productCategorySlug,
  productDisplayCategory,
  SHOP_CATEGORY_LABELS,
  SHOP_CATEGORY_RAIL,
  type ShopCategorySlug,
} from "@/lib/shop/categories";
import { productPriceLabel } from "@/lib/shop/copy";
import { coarseSold } from "@/lib/shop/sales-display";
import { loadShopTrending } from "@/lib/shop/trending";

export const metadata: Metadata = {
  title: "CokeAI 小店",
  description:
    "ChatGPT、Claude、Gemini、Grok、Muse 订阅与成品号，以及邮箱、接码等数字商品，人工处理，订单可追踪。",
};

export const dynamic = "force-dynamic";

/** 每页商品数。想调整分页大小只改这一处。 */
const PAGE_SIZE = 12;

/**
 * Links always start from page 1 unless a page is given, so switching category
 * or search resets paging. `page` is dropped at 1 to keep URLs clean.
 */
function shopHref(category: ShopCategorySlug, query = "", page = 1): string {
  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/shop?${suffix}` : "/shop";
}

/**
 * All search tokens must appear in the haystack. Matching runs in memory over
 * the already loaded catalog (the public list is small), so no user input ever
 * reaches SQL.
 */
function matchesSearch(product: PublicShopProduct, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    product.name,
    product.subtitle,
    product.brand,
    product.slug,
    product.display_category,
    productDisplayCategory(product),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!config.shopEnabled) notFound();

  const params = await searchParams;
  // Categories are a single public facet. An old ?brand= link is ignored
  // rather than rejected, so bookmarks keep working after the rail change.
  const category: ShopCategorySlug = isShopCategorySlug(params.category)
    ? params.category
    : "all";
  const query = (params.q || "").trim().slice(0, 60);
  const requestedPage = Number.parseInt(params.page || "1", 10);

  const [catalog, user, trending, recentRaw] = await Promise.all([
    listPublicProducts(),
    getCurrentUser(),
    loadShopTrending(4),
    listRecentPublicProducts(6),
  ]);
  // Members see their discounted price everywhere in the catalog; the order
  // action recomputes it server-side, so the displayed price is never trusted.
  const allProducts = await applyMemberPricing(catalog, user);
  // 「最近上新」独立查询：商品列表可能是筛选后的子集，不能从里面推。
  const recent = await applyMemberPricing(recentRaw, user);
  const searchPool = query
    ? allProducts.filter((product) => matchesSearch(product, query))
    : allProducts;

  const categoryCounts = new Map<ShopCategorySlug, number>(
    SHOP_CATEGORY_RAIL.map((item) => [item.slug, 0]),
  );
  for (const product of searchPool) {
    const slug = productCategorySlug(product);
    categoryCounts.set(slug, (categoryCounts.get(slug) || 0) + 1);
  }
  categoryCounts.set("all", searchPool.length);

  const products = filterProductsByCategory(searchPool, category);
  // Paging applies to the right-hand card list only. The sidebar counts and the
  // toolbar total stay on the filtered set, not the current page.
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages,
  );
  const pagedProducts = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const productById = new Map(allProducts.map((product) => [product.id, product]));

  // Hot strip: only real paid-order data, only on the unfiltered catalog.
  const hot =
    trending && !query && category === "all"
      ? trending.items
          .map((item) => ({
            units: item.units,
            product: productById.get(item.productId),
          }))
          .filter(
            (item): item is { units: number; product: PublicShopProduct } =>
              Boolean(item.product),
          )
      : [];
  const featuredProducts = allProducts.filter((product) => product.featured);
  const showFeatured =
    !query && category === "all" ? featuredProducts[0] || null : null;

  // Cross-sell: products outside the current view, featured first (the catalog
  // is already ordered that way). Never shown when the view is the full list.
  const visibleIds = new Set(products.map((product) => product.id));
  const recommended =
    (query || category !== "all") && products.length > 0
      ? allProducts
          .filter((product) => !visibleIds.has(product.id))
          .slice(0, 3)
      : [];
  // Sub-pages are rarely a curation signal; keep "also worth a look" on page 1.
  const showRecommended = recommended.length > 0 && page === 1;

  const categoryLabel = SHOP_CATEGORY_LABELS[category];

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main shop-page shop-market-page">
        <section className="shop-hero shop-hero-compact">
          <div className="container">
            <div className="shop-hero-inner">
              <div>
                <div className="hero-eyebrow">
                  <i />
                  CokeAI 小店
                </div>
                <h1>
                  常用 AI 订阅，
                  <br />
                  <em>在这里一次买齐。</em>
                </h1>
                <p>
                  按分类浏览、直接搜索，商品页内切换档位。下单后人工处理，
                  进度随时可查，完成后在订单页领取交付内容。
                </p>
              </div>
              <form className="shop-search" action="/shop" method="get" role="search">
                {category !== "all" ? (
                  <input type="hidden" name="category" value={category} />
                ) : null}
                <div className="shop-search-field">
                  <MagnifyingGlass size={18} />
                  <input
                    type="search"
                    name="q"
                    defaultValue={query}
                    placeholder="搜索商品，如 GPT、Claude、邮箱…"
                    aria-label="搜索商品"
                    maxLength={60}
                  />
                  {query ? (
                    <Link
                      href={shopHref(category, "", 1)}
                      className="shop-search-clear"
                      aria-label="清除搜索"
                    >
                      <X size={14} />
                    </Link>
                  ) : null}
                  <button type="submit">搜索</button>
                </div>
              </form>
            </div>
          </div>
        </section>

        <section className="container shop-market">
          <aside className="shop-sidebar">
            <nav className="shop-side-nav" aria-label="商品分类">
              <p className="shop-side-title">商品分类</p>
              {SHOP_CATEGORY_RAIL.map((item) => {
                const active = category === item.slug;
                return (
                  <Link
                    key={item.slug}
                    href={shopHref(item.slug, query, 1)}
                    className={`shop-side-link${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span>{item.label}</span>
                    <em>{categoryCounts.get(item.slug) || 0}</em>
                  </Link>
                );
              })}
            </nav>

            <RecentSidebar products={recent} />

            <div className="shop-side-help">
              <Question size={18} />
              <strong>不确定选哪个？</strong>
              <p>先看商品页的档位、发货时间和质保说明，再决定。</p>
              <Link href="/shop/terms">购买须知</Link>
            </div>
          </aside>

          <div className="shop-market-main">
            <div className="shop-toolbar">
              <p>
                {query ? (
                  <>
                    「{query}」的搜索结果
                    <span> · {products.length} 件</span>
                  </>
                ) : (
                  <>
                    {categoryLabel}
                    <span> · {products.length} 件商品</span>
                  </>
                )}
              </p>
              <AvailabilityLegend />
            </div>

            {hot.length > 0 ? (
              <section className="shop-hot" aria-label={trending?.label || "热销"}>
                <div className="shop-section-head">
                  <h2>{trending?.label}</h2>
                  <span>按已付款订单统计</span>
                </div>
                <div className="shop-hot-list">
                  {hot.map((item, index) => (
                    <Link
                      key={item.product.id}
                      href={`/shop/${item.product.slug}`}
                      className="shop-hot-item"
                    >
                      <span className="shop-hot-rank">{index + 1}</span>
                      <div>
                        <strong>{item.product.name}</strong>
                        <span>
                          {productDisplayCategory(item.product)} · 已售{" "}
                          {coarseSold(item.units)} 件
                        </span>
                      </div>
                      <em>{productPriceLabel(startingPriceMicros(item.product))}</em>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {showFeatured ? <ShopFeaturedCard product={showFeatured} /> : null}

            {products.length === 0 ? (
              <div className="shop-empty-state">
                <Package size={32} />
                <h2>{query ? "没有匹配的商品" : "这一栏正在补货"}</h2>
                <p>
                  {query
                    ? `没有找到与「${query}」相关的商品。换个关键词，或浏览全部分类。`
                    : "暂时没有可售商品。看看其他分类，或者稍后再来。"}
                </p>
                <Link
                  className="btn btn-light"
                  href={query ? "/shop" : shopHref("all")}
                >
                  {query ? "清除搜索" : "查看全部"} <ArrowRight size={15} />
                </Link>
              </div>
            ) : (
              <>
                <div className="shop-row-list">
                  {pagedProducts.map((product) => (
                    <ProductRow product={product} key={product.id} />
                  ))}
                </div>
                <Pagination
                  className="pager--public"
                  page={page}
                  totalPages={totalPages}
                  total={products.length}
                  nouns="件商品"
                  hrefFor={(next) => shopHref(category, query, next)}
                  action="/shop"
                  hidden={{
                    category: category === "all" ? undefined : category,
                    q: query || undefined,
                  }}
                />
              </>
            )}

            {showRecommended ? (
              <section className="shop-recommend">
                <div className="shop-section-head">
                  <h2>也可以看看</h2>
                  <span>其他分类的商品</span>
                </div>
                <div className="shop-recommend-grid">
                  {recommended.map((product) => (
                    <ProductCard product={product} key={product.id} />
                  ))}
                </div>
              </section>
            ) : null}

            <div className="shop-note">
              <p>
                所有商品均为数字商品，由人工处理。缺货商品会显示“补货中”，无法下单。
              </p>
              <p>
                售后请联系{" "}
                <a href={`mailto:${config.shopSupportEmail}`}>{config.shopSupportEmail}</a>
                ，或在订单页留言。购买前请阅读{" "}
                <Link href="/shop/terms">数字商品购买须知</Link>。
              </p>
            </div>
          </div>
        </section>
      </main>
      <ShopMascots />
      <SiteFooter />
    </>
  );
}
