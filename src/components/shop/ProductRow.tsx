import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { startingPriceMicros, type PublicShopProduct } from "@/lib/shop/catalog";
import { productDisplayCategory } from "@/lib/shop/categories";
import {
  etaLabel,
  productPriceLabel,
  warrantyShortLabel,
} from "@/lib/shop/copy";
import { productAvailabilityState, salesLabel } from "@/lib/shop/sales-display";
import { ProductCover } from "./ProductCover";
import { AvailabilityBadge } from "./ShopBadges";

/**
 * Catalog row. One product per row on desktop (cover, copy, tags, price,
 * action); it collapses to a stacked card on phones via CSS only, so the
 * whole row stays a single link.
 */
export function ProductRow({ product }: { product: PublicShopProduct }) {
  const price = startingPriceMicros(product);
  const hasVariants = product.variants.length > 0;
  const available =
    productAvailabilityState({
      availability: product.availability,
      preorder: product.preorder,
      soldOut: product.sales.soldOut,
    }) === "available";
  // 列表页用粗粒度库存/销量；精确数字只在商品详情页出现。
  const sales = salesLabel(product.sales, { available, coarse: true });
  return (
    <Link href={`/shop/${product.slug}`} className="shop-row">
      <div className="shop-row-cover">
        <ProductCover
          variant={product.cover_variant}
          brand={product.brand}
          imageUrl={product.image_url}
          sizes="(max-width: 720px) 88px, 132px"
        />
      </div>

      <div className="shop-row-main">
        <div className="shop-row-kicker">
          <span>{product.brand.toUpperCase() || "AI"}</span>
          <i />
          <span>{productDisplayCategory(product)}</span>
        </div>
        <h3>{product.name}</h3>
        <p>{product.subtitle}</p>
        <div className="shop-row-tags">
          <span>{etaLabel(product.eta_min_minutes, product.eta_max_minutes, product.preorder)}</span>
          <span>
            {warrantyShortLabel(
              product.warranty_type,
              product.warranty_days,
              product.warranty_note,
            )}
          </span>
          {hasVariants ? <span>{product.variants.length} 个档位</span> : null}
          {sales ? (
            <span className={`shop-row-sales${product.sales.soldOut ? " is-sold-out" : ""}`}>
              {sales}
            </span>
          ) : null}
        </div>
      </div>

      <div className="shop-row-side">
        <AvailabilityBadge
          availability={product.sales.soldOut ? "out_of_stock" : product.availability}
          preorder={product.preorder && !product.sales.soldOut}
        />
        <div className="shop-row-price">
          <strong>
            {productPriceLabel(price)}
            {hasVariants ? <em className="shop-price-from">起</em> : null}
          </strong>
          {product.list_price_micros ? (
            <s className="shop-price-was">
              {productPriceLabel(product.list_price_micros)}
            </s>
          ) : null}
        </div>
        <span className="shop-row-cta">
          查看详情 <ArrowUpRight size={14} />
        </span>
      </div>
    </Link>
  );
}
