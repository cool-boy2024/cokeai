import type { PublicShopProduct } from "./catalog";

/**
 * Public shop categories. Order is intentional: the rail mirrors the category
 * structure of the reference shop, while the labels stay our own neutral
 * wording. "all" is the reset entry and is never stored on a product.
 *
 * Every source (zyanai sync, feed imports, the future supplier API) writes one
 * of these labels into shop_products.display_category; anything else falls
 * back to 其他. Brands remain on products for covers, but they are no longer a
 * public filter dimension.
 */
export const SHOP_CATEGORY_RAIL = [
  { slug: "all", label: "全部" },
  { slug: "gpt", label: "ChatGPT" },
  { slug: "claude", label: "Claude" },
  { slug: "gemini", label: "Gemini" },
  { slug: "grok", label: "Grok" },
  { slug: "email", label: "邮箱" },
  { slug: "sms", label: "接码" },
  { slug: "other", label: "其他" },
] as const;

export type ShopCategorySlug = (typeof SHOP_CATEGORY_RAIL)[number]["slug"];
export type ShopProductCategorySlug = Exclude<ShopCategorySlug, "all">;

export const SHOP_CATEGORY_LABELS = Object.fromEntries(
  SHOP_CATEGORY_RAIL.map((item) => [item.slug, item.label]),
) as Record<ShopCategorySlug, string>;

/** Categories a product may be assigned to, in rail order. */
export const SHOP_PRODUCT_CATEGORIES = SHOP_CATEGORY_RAIL.filter(
  (item): item is (typeof SHOP_CATEGORY_RAIL)[number] & { slug: ShopProductCategorySlug } =>
    item.slug !== "all",
);

const SHOP_CATEGORY_SLUGS: ReadonlySet<string> = new Set(
  SHOP_CATEGORY_RAIL.map((item) => item.slug),
);

export function isShopCategorySlug(
  value: string | null | undefined,
): value is ShopCategorySlug {
  return typeof value === "string" && SHOP_CATEGORY_SLUGS.has(value);
}

export function isShopProductCategorySlug(
  value: string | null | undefined,
): value is ShopProductCategorySlug {
  return isShopCategorySlug(value) && value !== "all";
}

function categoryKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

const LABEL_TO_SLUG = new Map<string, ShopProductCategorySlug>();
for (const item of SHOP_CATEGORY_RAIL) {
  if (item.slug !== "all") LABEL_TO_SLUG.set(categoryKey(item.label), item.slug);
}

// Tolerate the slugs, the previous rail's values and a few obvious synonyms.
// Older rows still carry labels such as 谷歌, 设计类 AI or Muse; they resolve
// here so no database rewrite is needed.
const CATEGORY_ALIASES: Record<string, ShopProductCategorySlug> = {
  gpt: "gpt",
  chatgpt: "gpt",
  openai: "gpt",
  google: "gemini",
  gemini: "gemini",
  谷歌: "gemini",
  "设计类ai": "other",
  "设计ai": "other",
  design: "other",
  capcut: "other",
  youtube: "other",
  "youtube-油管": "other",
  油管: "other",
  suno: "other",
  autodesk: "other",
  heygen: "other",
  muse: "other",
  email: "email",
  邮箱: "email",
  邮箱号: "email",
  gmail: "email",
  outlook: "email",
  hotmail: "email",
  sms: "sms",
  接码: "sms",
  收码: "sms",
  短信: "sms",
  验证码: "sms",
};
for (const [alias, slug] of Object.entries(CATEGORY_ALIASES)) {
  LABEL_TO_SLUG.set(categoryKey(alias), slug);
}

type CategorizableProduct = Pick<
  PublicShopProduct,
  "display_category" | "brand" | "slug"
>;

/**
 * Resolves a product to a rail slug. display_category wins; products without
 * one fall back to brand. Muse and every unknown brand resolve to 其他.
 */
export function productCategorySlug(
  product: CategorizableProduct,
): ShopProductCategorySlug {
  const displayCategory = product.display_category || "";
  if (displayCategory.trim()) {
    return LABEL_TO_SLUG.get(categoryKey(displayCategory)) || "other";
  }

  const brand = categoryKey(product.brand || "");
  if (brand === "chatgpt") return "gpt";
  if (brand === "claude") return "claude";
  if (brand === "gemini") return "gemini";
  if (brand === "grok") return "grok";
  return "other";
}

/** Public label for a product, e.g. the rail label for its resolved category. */
export function productDisplayCategory(product: CategorizableProduct): string {
  return SHOP_CATEGORY_LABELS[productCategorySlug(product)];
}

/**
 * Collapses any supplier's category name to one of our canonical labels.
 * Adapters should write the result into display_category, never the raw value.
 */
export function normalizeDisplayCategory(value: string | null | undefined): string {
  const slug = LABEL_TO_SLUG.get(categoryKey(value || ""));
  return SHOP_CATEGORY_LABELS[slug || "other"];
}

/** Filters an already loaded list; "all"/unknown slugs are a no-op. */
export function filterProductsByCategory<T extends CategorizableProduct>(
  products: T[],
  category: string,
): T[] {
  if (category === "all" || !isShopCategorySlug(category)) return products;
  return products.filter((product) => productCategorySlug(product) === category);
}
