import { query } from "@/lib/db";
import type { PublicShopProduct } from "./catalog";
import {
  getMembershipInfo,
  memberPriceMicros,
  type MembershipUser,
} from "./membership";

/**
 * Cost lookup mirrors createShopOrder(): the primary active source first. The
 * cost is only used for the member-price floor and is never returned to the
 * browser.
 */
async function loadPrimaryCosts(
  productIds: string[],
): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  if (productIds.length === 0) return costs;
  const result = await query<{ product_id: string; supplier_cost_micros: string | number }>(
    `SELECT DISTINCT ON (s.product_id)
            s.product_id, s.supplier_cost_micros
       FROM shop_product_sources s
      WHERE s.product_id = ANY($1::uuid[]) AND s.active = TRUE
      ORDER BY s.product_id,
               CASE s.role WHEN 'primary' THEN 0 ELSE 1 END,
               s.created_at`,
    [productIds],
  );
  for (const row of result.rows) {
    costs.set(row.product_id, Number(row.supplier_cost_micros) || 0);
  }
  return costs;
}

/**
 * Returns copies with the member price applied. Non-members (and products
 * where the discount would not lower the price) are returned untouched, so
 * callers can compare `list_price_micros` to render the original price.
 */
export async function applyMemberPricing(
  products: PublicShopProduct[],
  user: MembershipUser,
): Promise<PublicShopProduct[]> {
  const membership = getMembershipInfo(user);
  if (!membership.active || membership.discountBps <= 0) return products;

  const costs = await loadPrimaryCosts(products.map((product) => product.id));
  return products.map((product) => {
    const price = memberPriceMicros(
      product.price_micros,
      costs.get(product.id) || 0,
      membership.discountBps,
    );
    if (price >= product.price_micros) return product;
    return {
      ...product,
      price_micros: price,
      list_price_micros: product.price_micros,
    };
  });
}
