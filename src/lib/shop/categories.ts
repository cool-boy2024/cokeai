import type { PublicShopProduct } from "./catalog";

/**
 * Primary shop categories. Order is intentional and mirrors the source shop;
 * labels are our own neutral wording. "all" is the reset entry and is never
 * stored on a product.
 */
export const SHOP_CATEGORY_RAIL = [
  { slug: "all", label: "全部" },
  { slug: "gpt", label: "GPT" },
  { slug: "google", label: "谷歌" },
  { slug: "grok", label: "Grok" },
  { slug: "claude", label: "Claude" },
  { slug: "design", label: "设计类 AI" },
  { slug: "capcut", label: "CapCut" },
  { slug: "youtube", label: "YouTube" },
  { slug: "suno", label: "Suno" },
  { slug: "autodesk", label: "Autodesk" },
  { slug: "heygen", label: "HeyGen" },
  { slug: "muse", label: "Muse" },
  { slug: "other", label: "其他" },
] as const;

export type ShopCategorySlug = (typeof SHOP_CATEGORY_RAIL)[number]["slug"];
export type ShopProductCategorySlug = Exclude<ShopCategorySlug, "all">;

export const SHOP_CATEGORY_LABELS = Object.fromEntries(
  SHOP_CATEGORY_RAIL.map((item) => [item.slug, item.label]),
) as Record<ShopCategorySlug, string>;

const SHOP_CATEGORY_SLUGS: ReadonlySet<string> = new Set(
  SHOP_CATEGORY_RAIL.map((item) => item.slug),
);

export function isShopCategorySlug(
  value: string | null | undefined,
): value is ShopCategorySlug {
  return typeof value === "string" && SHOP_CATEGORY_SLUGS.has(value);
}

function categoryKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

const LABEL_TO_SLUG = new Map<string, ShopProductCategorySlug>();
for (const item of SHOP_CATEGORY_RAIL) {
  if (item.slug !== "all") LABEL_TO_SLUG.set(categoryKey(item.label), item.slug);
}
// Tolerate the slugs and a few obvious synonyms if display_category was
// written by hand; the synced values use the labels above.
const CATEGORY_ALIASES: Record<string, ShopProductCategorySlug> = {
  chatgpt: "gpt",
  openai: "gpt",
  google: "google",
  gemini: "google",
  "设计类ai": "design",
  "油管": "youtube",
};
for (const [alias, slug] of Object.entries(CATEGORY_ALIASES)) {
  LABEL_TO_SLUG.set(categoryKey(alias), slug);
}

type CategorizableProduct = Pick<
  PublicShopProduct,
  "display_category" | "brand" | "slug"
>;

/**
 * Resolves a product to a rail slug. Synced display_category wins; products
 * without one fall back to brand (and a leading "muse" slug for legacy rows).
 */
export function productCategorySlug(
  product: CategorizableProduct,
): ShopProductCategorySlug {
  const displayCategory = product.display_category || "";
  if (displayCategory.trim()) {
    return LABEL_TO_SLUG.get(categoryKey(displayCategory)) || "other";
  }

  const brand = categoryKey(product.brand || "");
  const slug = categoryKey(product.slug || "");
  if (brand === "muse" || slug.startsWith("muse")) return "muse";
  if (brand === "chatgpt") return "gpt";
  if (brand === "claude") return "claude";
  if (brand === "grok") return "grok";
  if (brand === "gemini") return "google";
  return "other";
}

/** Public label for a product, e.g. "Design AI" is exposed as "设计类 AI". */
export function productDisplayCategory(product: CategorizableProduct): string {
  return SHOP_CATEGORY_LABELS[productCategorySlug(product)];
}

/** Filters an already brand-filtered list; "all"/unknown slugs are a no-op. */
export function filterProductsByCategory<T extends CategorizableProduct>(
  products: T[],
  category: string,
): T[] {
  if (category === "all" || !isShopCategorySlug(category)) return products;
  return products.filter((product) => productCategorySlug(product) === category);
}
