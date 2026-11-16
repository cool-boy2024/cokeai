import { query, toNumber } from "@/lib/db";

/**
 * Storefront sales / remaining-stock counters.
 *
 * Two numbers on every product card and product page:
 *   已售 N     = sold_baseline（站外历史销量，运营按真实流水填） + 本站已付款件数
 *   库存还剩 M = batch_size（本批次放量） − 本批次开始后的已付款件数
 *
 * The paid count is the only live input: a real order moves both numbers on the
 * next page load, no counter row to keep in sync and nothing to double-count.
 * `batch_size = 0` means the operator has not set a batch, so only 已售 shows.
 *
 * When a batch sells out and `batch_refill_minutes > 0`, the next batch opens
 * automatically once that interval has passed — see `refillSoldOutBatches`.
 *
 * These are display figures. Fulfilment, procurement and the real supplier
 * stock state stay on their own fields; nothing here feeds the order flow
 * except the sold-out label.
 */

export type { ShopSalesDisplay } from "./sales-display";
export { salesDisplay, salesLabel } from "./sales-display";

type SalesRow = {
  product_id: string;
  units: string | number;
  batch_units: string | number;
};

const PAID_STATUSES = `('paid', 'procuring', 'delivered')`;

/**
 * Sold-out batches whose auto-refill interval has elapsed get a fresh start.
 *
 * Runs before each catalogue read: it is a single UPDATE that only touches
 * rows that are actually exhausted, so the common case scans and writes
 * nothing. Two shop loads racing on the same product both push the start to
 * `now()`, which is the same outcome as one of them doing it.
 */
export async function refillSoldOutBatches(): Promise<void> {
  try {
    await query(
      `UPDATE shop_products p
          SET batch_started_at = now(), updated_at = now()
        WHERE p.batch_size > 0
          AND p.batch_refill_minutes > 0
          AND p.batch_started_at + make_interval(mins => p.batch_refill_minutes) <= now()
          AND (
            SELECT COALESCE(SUM(i.qty), 0)
              FROM shop_order_items i
              JOIN shop_orders o ON o.id = i.order_id
             WHERE i.product_id = p.id
               AND o.status IN ${PAID_STATUSES}
               AND o.paid_at IS NOT NULL
               AND o.paid_at >= p.batch_started_at
          ) >= p.batch_size`,
    );
  } catch (error) {
    // A missing table/migration must not take the catalogue down.
    console.warn("shop batch refill unavailable:", error);
  }
}

export type ProductPaidUnits = { total: number; inBatch: number };

/**
 * Paid unit counts per product: lifetime (for 已售) and since the current
 * batch started (for 库存还剩). Same status rule as the admin analytics and
 * the hot strip — the order must be paid and not cancelled/refunded.
 */
export async function loadProductPaidUnits(
  productIds: string[],
): Promise<Map<string, ProductPaidUnits>> {
  const units = new Map<string, ProductPaidUnits>();
  if (productIds.length === 0) return units;
  try {
    const rows = await query<SalesRow>(
      `SELECT i.product_id,
              SUM(i.qty)::text AS units,
              SUM(i.qty) FILTER (WHERE o.paid_at >= p.batch_started_at)::text AS batch_units
         FROM shop_order_items i
         JOIN shop_orders o ON o.id = i.order_id
         JOIN shop_products p ON p.id = i.product_id
        WHERE i.product_id = ANY($1::uuid[])
          AND o.status IN ${PAID_STATUSES}
          AND o.paid_at IS NOT NULL
        GROUP BY i.product_id`,
      [productIds],
    );
    for (const row of rows.rows) {
      units.set(row.product_id, {
        total: toNumber(row.units),
        inBatch: toNumber(row.batch_units),
      });
    }
  } catch (error) {
    console.warn("shop display sales unavailable:", error);
  }
  return units;
}


