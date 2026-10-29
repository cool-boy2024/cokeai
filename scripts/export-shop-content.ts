import { writeFileSync } from "node:fs";
import path from "node:path";
import { PRODUCTS } from "./shop-seed";
import { SHOP_SOURCE_COPY, sourceCopyText } from "./shop-source-copy";

/**
 * Writes the seed catalogue to scripts/shop-content.json.
 *
 * The production image does not run shop:seed (it imports demo products). This
 * snapshot is the input for `node scripts/shop-publish.mjs`, which updates the
 * existing products' copy and can create the new Muse product.
 */
const content = PRODUCTS.map((product) => {
  const source = SHOP_SOURCE_COPY[product.slug];
  return {
    slug: product.slug,
    brand: product.brand,
    category: product.category,
    productType: product.productType,
    name: product.name,
    subtitle: product.subtitle,
    description: sourceCopyText(product.slug) ?? product.description,
    cover: product.cover,
    price: product.price,
    etaMin: product.etaMin,
    etaMax: product.etaMax,
    warrantyType: product.warrantyType,
    warrantyDays: product.warrantyDays,
    warrantyNote: source?.warrantyNote ?? product.warrantyNote,
    includes: product.includes,
    usage: product.usage,
    notice: product.notice,
    refund: product.refund,
    inputFields: product.inputFields,
    featured: product.featured,
    sort: product.sort,
    offer: product.offer,
    sourceUrl: source?.url ?? null,
    sourceCapturedAt: source?.capturedAt ?? null,
  };
});

const out = path.join(process.cwd(), "scripts/shop-content.json");
writeFileSync(out, `${JSON.stringify(content, null, 2)}\n`, "utf8");
console.log(
  `wrote ${content.length} products to scripts/shop-content.json ` +
    `(${content.filter((item) => item.sourceUrl).length} with supplier copy)`,
);
