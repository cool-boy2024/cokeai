import Link from "next/link";
import type { PublicShopProduct } from "@/lib/shop/catalog";
import { buildShopNotices } from "@/lib/shop/notices";

export function ProductNotices({ product }: { product: PublicShopProduct }) {
  const notices = buildShopNotices(product);

  return (
    <section className="shop-notices" aria-labelledby="shop-notices-title">
      <div className="shop-notices-head">
        <h2 id="shop-notices-title">重点注意事项</h2>
        <span className="shop-notices-tag">{notices.tag}</span>
      </div>
      <p className="shop-notices-lead">{notices.lead}</p>

      <div className="shop-notices-groups">
        {notices.groups.map((group) => (
          <div
            key={group.key}
            className={`shop-notice-group${group.tone === "warning" ? " is-warning" : ""}`}
          >
            <h3>{group.title}</h3>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="shop-notices-foot">
        完整规则见 <Link href="/shop/terms">数字商品购买须知</Link>。有疑问请先在订单页联系客服，不要重复下单。
      </p>
    </section>
  );
}
