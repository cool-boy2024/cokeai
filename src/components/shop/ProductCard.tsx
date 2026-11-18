import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { startingPriceMicros, type PublicShopProduct } from "@/lib/shop/catalog";
import { etaLabel, productPriceLabel, warrantyShortLabel } from "@/lib/shop/copy";
import { productAvailabilityState, salesLabel } from "@/lib/shop/sales-display";
import { ProductCover } from "./ProductCover";
import { AvailabilityBadge } from "./ShopBadges";

export function ProductCard({
  product,
  featured = false,
}: {
  product: PublicShopProduct;
  featured?: boolean;
}) {
  const price = startingPriceMicros(product);
  const hasVariants = product.variants.length > 0;
  // 文案和徽标共用同一个可售判断，避免「补货中 · 现货充足」。
  const available =
    productAvailabilityState({
      availability: product.availability,
      preorder: product.preorder,
      soldOut: product.sales.soldOut,
    }) === "available";
  // 列表页用粗粒度库存/销量；精确数字只在商品详情页出现。
  const sales = salesLabel(product.sales, { available, coarse: true });
  return (
    <Link
      href={`/shop/${product.slug}`}
      className={`shop-product-card${featured ? " is-featured" : ""}`}
    >
      <ProductCover
        variant={product.cover_variant}
        brand={product.brand}
        imageUrl={product.image_url}
        sizes={
          featured
            ? "(max-width: 680px) 92vw, 560px"
            : "(max-width: 680px) 46vw, 300px"
        }
      />
      <div className="shop-product-card-body">
        <div className="shop-product-card-top">
          <span className="shop-product-brand">{product.brand.toUpperCase()}</span>
          <AvailabilityBadge
            availability={product.sales.soldOut ? "out_of_stock" : product.availability}
            preorder={product.preorder && !product.sales.soldOut}
          />
        </div>
        <h3>{product.name}</h3>
        <p>{product.subtitle}</p>
        {sales ? (
          <span
            className={`shop-product-sales${product.sales.soldOut ? " is-sold-out" : ""}`}
          >
            {sales}
          </span>
        ) : null}
        <div className="shop-product-card-foot">
          <div>
            <strong>
              {productPriceLabel(price)}
              {hasVariants ? <em className="shop-price-from">起</em> : null}
              {product.list_price_micros ? (
                <s className="shop-price-was">
                  {productPriceLabel(product.list_price_micros)}
                </s>
              ) : null}
            </strong>
            <span>
              {etaLabel(
                product.eta_min_minutes,
                product.eta_max_minutes,
                product.preorder,
              )}{" "}
              ·{" "}
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
