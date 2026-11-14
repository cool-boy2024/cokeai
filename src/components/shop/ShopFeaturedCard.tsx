import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { startingPriceMicros, type PublicShopProduct } from "@/lib/shop/catalog";
import { etaLabel, productPriceLabel, warrantyShortLabel } from "@/lib/shop/copy";
import { ProductCover } from "./ProductCover";

/**
 * The one pinned product on the catalog. Operators choose it with the
 * "主推商品" switch; the card carries the same real price, ETA and warranty as
 * the product page and adds no claims the product does not make.
 */
export function ShopFeaturedCard({ product }: { product: PublicShopProduct }) {
  const price = startingPriceMicros(product);
  const hasVariants = product.variants.length > 0;
  return (
    <Link href={`/shop/${product.slug}`} className="shop-feature-card">
      <div className="shop-feature-copy">
        <span className="shop-feature-kicker">主推推荐</span>
        <h2>{product.name}</h2>
        <p>{product.subtitle}</p>
        <div className="shop-feature-meta">
          <span>
            {etaLabel(product.eta_min_minutes, product.eta_max_minutes, product.preorder)}
          </span>
          <i />
          <span>
            {warrantyShortLabel(
              product.warranty_type,
              product.warranty_days,
              product.warranty_note,
            )}
          </span>
          {hasVariants ? (
            <>
              <i />
              <span>{product.variants.length} 个档位可选</span>
            </>
          ) : null}
        </div>
        <div className="shop-feature-foot">
          <div className="shop-feature-price">
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
          <span className="shop-feature-cta">
            立即选购 <ArrowRight size={16} />
          </span>
        </div>
      </div>
      <div className="shop-feature-cover">
        <ProductCover
          variant={product.cover_variant}
          brand={product.brand}
          imageUrl={product.image_url}
          sizes="(max-width: 960px) 40vw, 360px"
        />
      </div>
    </Link>
  );
}
