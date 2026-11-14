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
): Promise<{ products: Map<string, number>; variants: Map<string, number> }> {
  const products = new Map<string, number>();
  const variants = new Map<string, number>();
  if (productIds.length === 0) return { products, variants };
  const [productResult, variantResult] = await Promise.all([
    query<{ product_id: string; supplier_cost_micros: string | number }>(
      `SELECT DISTINCT ON (s.product_id)
              s.product_id, s.supplier_cost_micros
         FROM shop_product_sources s
        WHERE s.product_id = ANY($1::uuid[]) AND s.active = TRUE
        ORDER BY s.product_id,
                 CASE s.role WHEN 'primary' THEN 0 ELSE 1 END,
                 s.created_at`,
      [productIds],
    ),
    query<{ variant_id: string; supplier_cost_micros: string | number }>(
      `SELECT DISTINCT ON (s.variant_id)
              s.variant_id, s.supplier_cost_micros
         FROM shop_product_sources s
        WHERE s.product_id = ANY($1::uuid[]) AND s.active = TRUE
          AND s.variant_id IS NOT NULL
        ORDER BY s.variant_id,
                 CASE s.role WHEN 'primary' THEN 0 ELSE 1 END,
                 s.created_at`,
      [productIds],
    ),
  ]);
  for (const row of productResult.rows) {
    products.set(row.product_id, Number(row.supplier_cost_micros) || 0);
  }
  for (const row of variantResult.rows) {
    variants.set(row.variant_id, Number(row.supplier_cost_micros) || 0);
  }
  return { products, variants };
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
    const productCost = costs.products.get(product.id) || 0;
    const price = memberPriceMicros(
      product.price_micros,
      productCost,
      membership.discountBps,
    );

    // Each option keeps its own floor: a cheap tier must not be discounted
    // below the cost of the offer that fulfils it.
    const variants = product.variants.map((variant) => {
      const variantPrice = memberPriceMicros(
        variant.price_micros,
        costs.variants.get(variant.id) ?? productCost,
        membership.discountBps,
      );
      return variantPrice < variant.price_micros
        ? {
            ...variant,
            price_micros: variantPrice,
            list_price_micros: variant.price_micros,
          }
        : variant;
    });
    const variantsChanged = variants.some(
      (variant, index) => variant.price_micros !== product.variants[index].price_micros,
    );
    if (price >= product.price_micros && !variantsChanged) return product;

    const fromPrice =
      variants.length > 0
        ? Math.min(...variants.map((variant) => variant.price_micros))
        : price;
    const fromListPrice =
      variants.length > 0
        ? Math.min(...product.variants.map((variant) => variant.price_micros))
        : product.price_micros;

    return {
      ...product,
      price_micros: fromPrice,
      list_price_micros: fromListPrice > fromPrice ? fromListPrice : product.list_price_micros,
      variants,
    };
  });
}
