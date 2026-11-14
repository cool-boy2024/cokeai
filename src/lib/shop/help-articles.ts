/**
 * Bridges shop products to the help center. Every product also gets one
 * first-party category guide (`guide.*`, seeded from scripts/guides.mjs);
 * supplier articles keep the `article.` prefix and are appended afterwards.
 */

import {
  productCategorySlug,
  type ShopProductCategorySlug,
} from "./categories";

const CATEGORY_GUIDE_IDS: Record<ShopProductCategorySlug, string> = {
  gpt: "guide.gpt",
  claude: "guide.claude",
  gemini: "guide.gemini",
  grok: "guide.grok",
  email: "guide.email",
  sms: "guide.sms",
  other: "guide.other",
};

const MUSE_HELP_IDS = ["article.9"];
const CHATGPT_HELP_IDS = ["article.10"];
const ACCOUNT_HELP_IDS = ["article.6", "article.7", "article.8"];
const GEMINI_HELP_IDS = ["article.5"];

const EXACT_HELP_IDS: Record<string, string[]> = {
  "zy-84-chatgpt-gpt-plus": CHATGPT_HELP_IDS,
  "zy-213-chatgpt-gpt": CHATGPT_HELP_IDS,
  "zy-155": ACCOUNT_HELP_IDS,
  "zy-546": ACCOUNT_HELP_IDS,
  "zy-27-gemini-gemini-ulrta20x-gemini-4": GEMINI_HELP_IDS,
  "zy-508-gemini-ulrta20x-5": GEMINI_HELP_IDS,
};

const ARTICLE_ID_PATTERN = /^article\.\d+$/;

export function getManualHelpArticleIds(slug: string, _brand: string): string[] {
  if (slug.startsWith("muse-")) return MUSE_HELP_IDS;
  return EXACT_HELP_IDS[slug] ?? [];
}

export function getProductHelpArticleIds(product: {
  slug: string;
  brand: string;
  display_category: string;
  help_article_ids: string[];
}): string[] {
  const own = Array.isArray(product.help_article_ids)
    ? product.help_article_ids.filter(
        (id): id is string => typeof id === "string" && ARTICLE_ID_PATTERN.test(id),
      )
    : [];
  const supplierIds = own.length > 0 ? own : getManualHelpArticleIds(product.slug, product.brand);
  const guideId = CATEGORY_GUIDE_IDS[productCategorySlug(product)];
  return Array.from(new Set([guideId, ...supplierIds]));
}
