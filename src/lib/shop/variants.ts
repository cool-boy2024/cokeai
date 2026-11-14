/**
 * Pure variant helpers, kept free of database imports so they can be unit
 * tested without a running Postgres.
 */

/**
 * One selectable option ("宝贝类型") under a product. Prices are the retail
 * price of that option; the order action recomputes them server-side.
 */
export type ShopVariant = {
  id: string;
  variant_key: string;
  label: string;
  badge: string;
  price_micros: number;
  /** Retail price before an active member discount, when one was applied. */
  list_price_micros?: number | null;
  warranty_type: string;
  warranty_days: number;
  warranty_note: string;
  availability: string;
  preorder: boolean;
  sort_order: number;
};

/** Price shown on list cards: the cheapest active option, else the base price. */
export function startingPriceMicros(product: {
  price_micros: number;
  variants?: ShopVariant[];
}): number {
  const prices = (product.variants || [])
    .filter((variant) => variant.price_micros > 0)
    .map((variant) => variant.price_micros);
  return prices.length > 0 ? Math.min(...prices) : product.price_micros;
}
