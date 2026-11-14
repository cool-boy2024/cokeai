import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import type { PublicShopProduct } from "@/lib/shop/catalog";
import { etaLabel, productPriceLabel, warrantyShortLabel } from "@/lib/shop/copy";
import { ProductCover } from "./ProductCover";
import { AvailabilityBadge } from "./ShopBadges";

export function ProductCard({
  product,
  featured = false,
}: {
  product: PublicShopProduct;
  featured?: boolean;
}) {
  return (
    <Link
      href={`/shop/${product.slug}`}
      className={`shop-product-card${featured ? " is-featured" : ""}`}
    >
      <ProductCover
        variant={product.cover_variant}
        brand={product.brand}
        imageUrl={product.image_url}
      />
      <div className="shop-product-card-body">
        <div className="shop-product-card-top">
          <span className="shop-product-brand">{product.brand.toUpperCase()}</span>
          <AvailabilityBadge availability={product.availability} />
        </div>
        <h3>{product.name}</h3>
        <p>{product.subtitle}</p>
        <div className="shop-product-card-foot">
          <div>
            <strong>{productPriceLabel(product.price_micros)}</strong>
            <span>
              {etaLabel(product.eta_min_minutes, product.eta_max_minutes)} ·{" "}
              {warrantyShortLabel(
                product.warranty_type,
                product.warranty_days,
                product.warranty_note,
              )}
            </span>
          </div>
          <span className="shop-card-arrow">
            <ArrowUpRight size={16} />
          </span>
        </div>
      </div>
    </Link>
  );
}
