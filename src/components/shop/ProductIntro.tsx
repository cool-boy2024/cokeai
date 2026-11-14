import type { PublicShopProduct } from "@/lib/shop/catalog";
import { buildShopFacts } from "@/lib/shop/intro";
import { ExpandableText } from "./ExpandableText";

export function ProductIntro({ product }: { product: PublicShopProduct }) {
  const facts = buildShopFacts(product);
  const richHtml = product.description_html;
  const richHasImages = richHtml.includes("<img");
  // Mirrored products keep the supplier article's layout. Older or manual
  // products fall back to the plain-text copy and the image gallery.
  const showGallery = product.description_images.length > 0 && !richHasImages;

  return (
    <section className="shop-section shop-intro">
      <h2>商品介绍</h2>
      {richHtml ? (
        <div
          className="shop-rich-content"
          // HTML is produced by buildRichDescriptionHtml: allow-listed tags,
          // scrubbed text, mirrored images only.
          dangerouslySetInnerHTML={{ __html: richHtml }}
        />
      ) : (
        <ExpandableText
          className="shop-description shop-source-copy"
          text={product.description}
        />
      )}

      {showGallery ? (
        <div className="shop-description-images">
          {product.description_images.slice(0, 8).map((image) => (
            <figure key={image.url}>
              <img
                src={image.url}
                alt={image.alt}
                loading="lazy"
                decoding="async"
              />
            </figure>
          ))}
        </div>
      ) : null}

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
