import Link from "next/link";
import { startingPriceMicros, type PublicShopProduct } from "@/lib/shop/catalog";
import { productPriceLabel } from "@/lib/shop/copy";
import { ProductCover } from "./ProductCover";

/** 横条最多展示 6 条。 */
const STRIP_LIMIT = 6;

/**
 * 主列顶部的「最近上新」细横条。
 * 刻意保持与商品列表同一套排版语言：小号封面色块、单行商品名、弱化价格，
 * 不做卡片、不做轮播箭头，只和工具栏之间用一条细线分隔。
 */
export function RecentStrip({ products }: { products: PublicShopProduct[] }) {
  const items = products.slice(0, STRIP_LIMIT);
  if (items.length === 0) return null;

  return (
    <section className="shop-recent-strip" aria-label="最近上新">
      <p className="shop-recent-strip-label">最近上新</p>
      <ul className="shop-recent-strip-list">
        {items.map((product) => (
          <li key={product.id}>
            <Link href={`/shop/${product.slug}`} className="shop-recent-strip-item">
              <span className="shop-recent-strip-cover">
                <ProductCover
                  variant={product.cover_variant}
                  brand={product.brand}
                  imageUrl={product.image_url}
                  sizes="22px"
                />
              </span>
              <span className="shop-recent-strip-name">{product.name}</span>
              <span className="shop-recent-strip-price">
                {productPriceLabel(startingPriceMicros(product))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/shop" className="shop-recent-strip-more">
        查看全部
      </Link>
    </section>
  );
}
