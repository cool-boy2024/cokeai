import type { PublicShopProduct } from "@/lib/shop/catalog";
import { buildShopFacts } from "@/lib/shop/intro";
import { ExpandableText } from "./ExpandableText";

export function ProductIntro({ product }: { product: PublicShopProduct }) {
  const facts = buildShopFacts(product);

  return (
    <section className="shop-section shop-intro">
      <h2>商品介绍</h2>
      <ExpandableText
        className="shop-description shop-source-copy"
        text={product.description}
      />

      <dl className="shop-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
