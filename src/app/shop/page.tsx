import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Headset,
  Package,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { ProductCard } from "@/components/shop/ProductCard";
import { AvailabilityLegend } from "@/components/shop/ShopBadges";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { listPublicProducts } from "@/lib/shop/catalog";
import { applyMemberPricing } from "@/lib/shop/member-pricing";
import {
  filterProductsByCategory,
  isShopCategorySlug,
  productCategorySlug,
  SHOP_CATEGORY_RAIL,
  type ShopCategorySlug,
} from "@/lib/shop/categories";

export const metadata: Metadata = {
  title: "CokeAI 小店",
  description:
    "ChatGPT、Claude、Gemini、Grok、Muse 订阅与成品号，以及邮箱、接码等数字商品，人工处理，订单可追踪。",
};

export const dynamic = "force-dynamic";

function shopHref(category: ShopCategorySlug): string {
  return category === "all" ? "/shop" : `/shop?category=${category}`;
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

  const [catalog, user] = await Promise.all([
    listPublicProducts(),
    getCurrentUser(),
  ]);
  // Members see their discounted price everywhere in the catalog; the order
  // action recomputes it server-side, so the displayed price is never trusted.
  const allProducts = await applyMemberPricing(catalog, user);
  const categoryCounts = new Map<ShopCategorySlug, number>(
    SHOP_CATEGORY_RAIL.map((item) => [item.slug, 0]),
  );
  for (const product of allProducts) {
    const slug = productCategorySlug(product);
    categoryCounts.set(slug, (categoryCounts.get(slug) || 0) + 1);
  }
  categoryCounts.set("all", allProducts.length);
  // Every category stays visible, including empty ones, so the structure does
  // not change shape as stock comes and goes.
  const visibleCategories = SHOP_CATEGORY_RAIL;
  const products = filterProductsByCategory(allProducts, category);
  const showFeatured = category === "all" && products.length >= 3;

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main shop-page">
        <section className="shop-hero">
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
                  ChatGPT、Claude、Gemini、Grok、Muse，以及邮箱、接码等数字商品。
                  下单后人工处理，订单进度随时可查，完成后在订单页领取交付内容。
                </p>
              </div>
              <div className="shop-hero-points">
                <span>
                  <Clock size={16} /> 商品页标注预计发货时间
                </span>
                <span>
                  <CheckCircle size={16} /> 质保按商品标注
                </span>
                <span>
                  <Headset size={16} /> 订单内售后
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="container shop-catalog">
          <div className="shop-catalog-head">
            <div className="shop-catalog-filters">
              <nav className="shop-category-rail" aria-label="商品分类">
                {visibleCategories.map((item) => {
                  const active = category === item.slug;
                  return (
                    <Link
                      key={item.slug}
                      href={shopHref(item.slug)}
                      className={`shop-category-link${active ? " active" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="shop-category-label">{item.label}</span>
                      <span className="shop-category-count">
                        {categoryCounts.get(item.slug) || 0}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </div>
            <AvailabilityLegend />
          </div>

          {products.length === 0 ? (
            <div className="shop-empty-state">
              <Package size={32} />
              <h2>这一栏正在补货</h2>
              <p>暂时没有可售商品。看看其他分类，或者稍后再来。</p>
              <Link className="btn btn-light" href="/shop">
                查看全部 <ArrowRight size={15} />
              </Link>
            </div>
          ) : (
            <Reveal>
              <div className="shop-grid shop-grid-catalog">
                {products.map((product, index) => (
                  <ProductCard
                    product={product}
                    featured={showFeatured && index === 0}
                    key={product.id}
                  />
                ))}
              </div>
            </Reveal>
          )}

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
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
