import Link from "next/link";
import type { PublicShopProduct } from "@/lib/shop/catalog";

/**
 * Renders the product's own purchase and refund copy. The seed script fills
 * these fields from the supplier's product page, so the page never invents
 * warranty or refund promises the supplier does not make.
 */
export function ProductNotices({
  product,
  image,
}: {
  product: PublicShopProduct;
  image?: { src: string; alt: string; caption: string };
}) {
  const groups = [
    { key: "notice", title: "购买须知", text: product.customer_notice.trim() },
    { key: "refund", title: "售后与退款", text: product.refund_policy.trim() },
  ].filter((group) => group.text);

  if (groups.length === 0) return null;

  return (
    <section className="shop-notices" aria-labelledby="shop-notices-title">
      <div className="shop-notices-head">
        <h2 id="shop-notices-title">重点注意事项</h2>
        <span className="shop-notices-tag">购买与售后</span>
      </div>
      <p className="shop-notices-lead">
        以下为商品的购买须知与售后说明，请在下单前逐条确认。
      </p>

      <div className="shop-notices-groups">
        {groups.map((group) => (
          <div key={group.key} className="shop-notice-group is-warning">
            <h3>{group.title}</h3>
            <p className="shop-notice-text">{group.text}</p>
            {group.key === "notice" && image ? (
              <figure className="shop-notice-figure">
                <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
                <figcaption>{image.caption}</figcaption>
              </figure>
            ) : null}
          </div>
        ))}
      </div>

      <p className="shop-notices-foot">
        完整规则见 <Link href="/shop/terms">数字商品购买须知</Link>。有疑问请先在订单页联系客服，不要重复下单。
      </p>
    </section>
  );
}
