import { query, toNumber } from "@/lib/db";

/**
 * Catalog "hot" strip, driven only by real paid orders.
 *
 * A paid line is counted with the same status rule as the admin analytics
 * (paid / procuring / delivered and a paid_at timestamp). The day boundary is
 * Asia/Shanghai. With fewer than three units today the strip falls back to the
 * last seven days; with fewer than three units there too, nothing is shown —
 * the page never invents sales numbers.
 */

const MIN_UNITS = 3;

export type ShopTrendingItem = {
  productId: string;
  units: number;
};

export type ShopTrending = {
  window: "today" | "d7";
  label: string;
  items: ShopTrendingItem[];
};

type TrendingRow = {
  product_id: string;
  units: string | number;
  today_units: string | number;
};

export async function loadShopTrending(limit = 4): Promise<ShopTrending | null> {
  try {
    const result = await query<TrendingRow>(
      `WITH bounds AS (
         SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS today_start,
                (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') - INTERVAL '6 days' AS start_7d
       )
       SELECT i.product_id,
              SUM(i.qty)::text AS units,
              COALESCE(SUM(i.qty) FILTER (WHERE o.paid_at >= b.today_start), 0)::text AS today_units
         FROM shop_order_items i
         JOIN shop_orders o ON o.id = i.order_id
         CROSS JOIN bounds b
        WHERE o.status IN ('paid', 'procuring', 'delivered')
          AND o.paid_at IS NOT NULL
          AND i.product_id IS NOT NULL
          AND o.paid_at >= b.start_7d
        GROUP BY i.product_id`,
    );

    const rows = result.rows.map((row) => ({
      productId: row.product_id,
      units: toNumber(row.units),
      todayUnits: toNumber(row.today_units),
    }));
    const todayTotal = rows.reduce((sum, row) => sum + row.todayUnits, 0);
    const useToday = todayTotal >= MIN_UNITS;
    const window = useToday ? "today" : "d7";
    const items = rows
      .filter((row) => row.units >= MIN_UNITS)
      .map((row) => ({
        productId: row.productId,
        units: useToday ? row.todayUnits : row.units,
      }))
      .filter((row) => row.units > 0)
      .sort((a, b) => b.units - a.units)
      .slice(0, limit);

    if (items.length === 0) return null;
    return {
      window,
      label: useToday ? "今日热销" : "近 7 天热销",
      items,
    };
  } catch (error) {
    // A missing table or a cold database must never take the catalog down.
    console.warn("shop trending unavailable:", error);
    return null;
  }
}
