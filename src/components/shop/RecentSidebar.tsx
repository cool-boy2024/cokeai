import Link from "next/link";
import { startingPriceMicros, type PublicShopProduct } from "@/lib/shop/catalog";
import { productPriceLabel } from "@/lib/shop/copy";
import { ProductCover } from "./ProductCover";

/** 侧栏最多展示 5 条。 */
const SIDEBAR_LIMIT = 5;

/**
 * 侧边栏「最近上新」模块。紧凑行：小封面 + 单行商品名 + 起价，
 * 整行是一个链接。空列表时整块不渲染。
 */
export function RecentSidebar({ products }: { products: PublicShopProduct[] }) {
  const items = products.slice(0, SIDEBAR_LIMIT);
  if (items.length === 0) return null;

  return (
    <section className="shop-side-recent" aria-label="最近上新">
      <p className="shop-side-title">最近上新</p>
      <ul className="shop-side-recent-list">
        {items.map((product) => (
          <li key={product.id}>
            <Link
              href={`/shop/${product.slug}`}
              className="shop-side-recent-item"
            >
              <span className="shop-side-recent-cover">
                <ProductCover
                  variant={product.cover_variant}
                  brand={product.brand}
                  imageUrl={product.image_url}
                  sizes="44px"
                />
              </span>
              <span className="shop-side-recent-copy">
                <strong>{product.name}</strong>
                <span className="shop-side-recent-price">
                  {productPriceLabel(startingPriceMicros(product))}
                  {product.variants.length > 0 ? (
                    <em className="shop-price-from">起</em>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/shop" className="shop-side-recent-more">
        查看全部
      </Link>
    </section>
  );
}
