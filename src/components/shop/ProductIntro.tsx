import type { PublicShopProduct } from "@/lib/shop/catalog";
import { buildShopIntro } from "@/lib/shop/intro";

export function ProductIntro({ product }: { product: PublicShopProduct }) {
  const intro = buildShopIntro(product);

  return (
    <section className="shop-section shop-intro">
      <h2>商品介绍</h2>
      <p className="shop-description">{product.description}</p>
      {intro.paragraphs.map((text) => (
        <p key={text} className="shop-intro-copy">
          {text}
        </p>
      ))}

      <dl className="shop-facts">
        {intro.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      {intro.groups.length > 0 ? (
        <div className="shop-intro-groups">
          {intro.groups.map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <ul className="shop-list">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
