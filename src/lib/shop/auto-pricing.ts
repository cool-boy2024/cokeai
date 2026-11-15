import { config } from "@/lib/config";
import { suggestRetailPrice } from "./catalog";

/**
 * Cost-derived retail price plus the operating markup.
 *
 * Supplier syncs recompute the cost-based suggestion on every run. Keeping the
 * markup in the same calculation means a sync refreshes the base price but
 * never drops the markup; operators do not have to lock every product by hand.
 * Default is ¥3 per product, override with SHOP_AUTO_PRICE_MARKUP_MICROS.
 */
export function autoRetailPrice(
  costMicros: number,
  targetMarginBps = 2_200,
): number {
  const base = suggestRetailPrice(costMicros, targetMarginBps);
  if (base <= 0) return 0;
  return base + Math.max(0, config.shopAutoPriceMarkupMicros);
}
