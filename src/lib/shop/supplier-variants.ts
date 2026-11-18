import { scanJson } from "./html-json";

/**
 * One selectable option ("宝贝类型") on a supplier product page.
 *
 * `costMicros` is the supplier's price for that option — what we pay, not the
 * retail price we charge. The caller applies the shop margin on top, the same
 * way it prices single-option products. We never take a wholesale/agent column
 * as a buyer option: those are tiered reseller prices for the same option.
 */
export type SupplierVariant = { label: string; costMicros: number };

const MAX_VARIANTS = 30;
const MAX_LABEL = 80;

type ItemConfig = {
  /** Option name -> retail price string, e.g. { "plus（质保全程）": "89.00" }. */
  category?: unknown;
  /** Reseller-only price maps. Never buyer options. */
  category_wholesale?: unknown;
  wholesale?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the buyer-selectable options from a supplier page's inline product JSON.
 *
 * The shared Tokyo storefront theme embeds `setVar("_var_item", { ... })` with
 * `config.category` mapping each option name to its price. The visible page has
 * no option text (the option list is rendered client-side), and the readable-text
 * extractor strips <script>, so this raw HTML is the only place the options exist.
 *
 * Returns an empty array when the page has no options (single-SKU products, a
 * `config: []`, a different theme, or a parse failure) — the product then sells
 * at its single price exactly as before.
 */
export function parseSupplierVariants(html: string): SupplierVariant[] {
  if (!html) return [];
  const item = scanJson(html, 'setVar("_var_item"') as
    | { config?: ItemConfig | unknown[] }
    | null;
  const config = item?.config;
  // `config` can be an array (empty options) or omit `category` (wholesale-only).
  if (!isRecord(config)) return [];

  const category = (config as ItemConfig).category;
  if (!isRecord(category)) return [];

  const variants: SupplierVariant[] = [];
  const seen = new Set<string>();
  for (const [rawLabel, rawPrice] of Object.entries(category)) {
    if (variants.length >= MAX_VARIANTS) break;
    const label = rawLabel.trim().slice(0, MAX_LABEL);
    if (!label || seen.has(label)) continue;
    const yuan = Number(String(rawPrice).trim());
    if (!Number.isFinite(yuan) || yuan <= 0) continue;
    seen.add(label);
    variants.push({ label, costMicros: Math.round(yuan * 1_000_000) });
  }
  return variants;
}
