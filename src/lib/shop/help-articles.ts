/**
 * Bridges shop products to the help center. Only mirrored supplier articles
 * (`article.N`) are linked; the first-party `guide.*` category tutorials were
 * removed on 2026-11-14 because product pages already carry the notices.
 */

const MUSE_HELP_IDS = ["article.9"];
const CHATGPT_HELP_IDS = ["article.10"];
const ACCOUNT_HELP_IDS = ["article.6", "article.7", "article.8"];
const GEMINI_HELP_IDS = ["article.5"];

const EXACT_HELP_IDS: Record<string, string[]> = {
  "p-84-chatgpt-gpt-plus": CHATGPT_HELP_IDS,
  "p-213-chatgpt-gpt": CHATGPT_HELP_IDS,
  "p-155": ACCOUNT_HELP_IDS,
  "p-546": ACCOUNT_HELP_IDS,
  "p-27-gemini-gemini-ulrta20x-gemini-4": GEMINI_HELP_IDS,
  "p-508-gemini-ulrta20x-5": GEMINI_HELP_IDS,
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
  return Array.from(new Set(supplierIds));
}
