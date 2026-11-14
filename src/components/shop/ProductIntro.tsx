import type { PublicShopProduct } from "@/lib/shop/catalog";
import { buildShopFacts } from "@/lib/shop/intro";
import { shopImageSrcSet, shopImageVariant } from "@/lib/shop/media-url";
import { ExpandableText } from "./ExpandableText";

const GALLERY_WIDTHS = [480, 960, 1280] as const;

export function ProductIntro({ product }: { product: PublicShopProduct }) {
  const facts = buildShopFacts(product);
  // Mirrored article images can be multi-megabyte originals; ask the media
  // route for a readable-width WebP instead of shipping the full screenshot.
  const richHtml = product.description_html.replace(
    /(<img\b[^>]*?)\bsrc="(\/api\/shop\/images\/[^"?]+)"/g,
    (_match, before: string, src: string) => `${before}src="${src}?w=1280"`,
  );
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
                src={shopImageVariant(image.url, 960) ?? image.url}
                srcSet={shopImageSrcSet(image.url, GALLERY_WIDTHS)}
                sizes="(max-width: 680px) 92vw, 720px"
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
