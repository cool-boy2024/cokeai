/**
 * Bridges shop products to the mirrored supplier help center. Products carry
 * their own help_article_ids once the importer has resolved them; otherwise a
 * small manual mapping covers the products where the supplier uses a shared
 * login tutorial. Article ids keep the `article.` prefix used by /help/[id].
 */

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
  help_article_ids: string[];
}): string[] {
  const own = Array.isArray(product.help_article_ids)
    ? product.help_article_ids.filter(
        (id): id is string => typeof id === "string" && ARTICLE_ID_PATTERN.test(id),
      )
    : [];
  const unique = Array.from(new Set(own));
  if (unique.length > 0) return unique;
  return getManualHelpArticleIds(product.slug, product.brand);
}
