import { query, toNumber } from "@/lib/db";
import { preorderSql } from "@/lib/shop/preorder";

/**
 * Shop business analytics.
 *
 * All money stays in integer micro-CNY (1 CNY = 1_000_000 micros). Windows
 * are calendar days in Asia/Shanghai. Every query below is a fixed, read-only
 * SELECT; the page never accepts user-supplied SQL, sort fields or filters.
 */

export const ANALYTICS_TIMEZONE = "Asia/Shanghai";

/**
 * Revenue is money the shop still holds. `refund_pending` is excluded because
 * the customer has already asked for it back; `cancelled`, `expired` and
 * `refunded` never count. `pending_payment` has not been paid yet.
 */
export const REVENUE_STATUSES = ["paid", "procuring", "delivered"] as const;

// Fixed literals derived from the list above (never user input), so the SQL
// and the documented definition cannot drift apart.
const REVENUE_STATUS_SQL = REVENUE_STATUSES.map((status) => `'${status}'`).join(", ");

export type WindowMetrics = {
  revenueMicros: number;
  costMicros: number;
  costedRevenueMicros: number;
  orders: number;
  missingCostOrders: number;
};

export type TrendPoint = {
  day: string;
  revenueMicros: number;
  costMicros: number;
  orders: number;
  missingRevenueMicros: number;
};

export type ChannelSlice = {
  label: string;
  revenueMicros: number;
  orders: number;
  sharePct: number;
};

export type ProductPerformance = {
  slug: string;
  name: string;
  brand: string;
  units: number;
  revenueMicros: number;
  costMicros: number;
  costKnown: boolean;
  grossProfitMicros: number | null;
  marginPct: number | null;
};

export type OperationsSummary = {
  pendingPayment: number;
  pendingPaymentAmountMicros: number;
  toProcure: number;
  toDeliver: number;
  refundPending: number;
  refunded: number;
};

export type ApiRechargeSummary = {
  revenueTodayMicros: number;
  revenue30dMicros: number;
  revenueAllMicros: number;
  orders30d: number;
  ordersAll: number;
  pending: number;
  aov30dMicros: number | null;
};

export type ShopAnalytics = {
  generatedAt: string;
  windows: {
    today: WindowMetrics;
    d7: WindowMetrics;
    d30: WindowMetrics;
    month: WindowMetrics;
    all: WindowMetrics;
  };
  previousRevenue: {
    d7Micros: number;
    d30Micros: number;
  };
  orders: {
    costed30d: number;
    missingCost30d: number;
    missingCostAll: number;
    preorder30d: number;
    preorderSharePct: number;
    aov30dMicros: number | null;
  };
  operations: OperationsSummary;
  trend: TrendPoint[];
  channels: ChannelSlice[];
  productsByRevenue: ProductPerformance[];
  productsByUnits: ProductPerformance[];
  apiRecharge: ApiRechargeSummary;
};

/* ------------------------------------------------------------------ */
/* Pure helpers (safe to unit test without a database)                */
/* ------------------------------------------------------------------ */

/** A line with cost <= 0 is treated as "成本未录入" rather than free. */
export function isCostKnown(itemCount: number, missingLines: number): boolean {
  return itemCount > 0 && missingLines === 0;
}

export function grossMarginPct(
  revenueMicros: number,
  costMicros: number,
): number | null {
  if (!Number.isFinite(revenueMicros) || revenueMicros <= 0) return null;
  return ((revenueMicros - costMicros) / revenueMicros) * 100;
}

export function averageOrderValue(
  revenueMicros: number,
  orders: number,
): number | null {
  if (!Number.isFinite(orders) || orders <= 0) return null;
  return revenueMicros / orders;
}

export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function sharePct(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * 100;
}

const CHANNEL_LABELS: Record<string, string> = {
  alipay_easypay: "支付宝（易支付）",
  alipay_manual: "支付宝（人工）",
  balance: "账户余额",
  usdt_trc20: "USDT · TRC20",
  usdt_bsc: "USDT · BEP20",
  usdt_polygon: "USDT · Polygon",
};

/** Unknown providers are grouped under 其它 instead of being guessed. */
export function channelLabel(provider: string): string {
  return CHANNEL_LABELS[provider] || "其它";
}

type ChannelAggRow = {
  payment_provider: string;
  orders: string | number;
  revenue_micros: string | number;
};

export function buildChannelSlices(rows: ChannelAggRow[]): ChannelSlice[] {
  const grouped = new Map<string, { revenueMicros: number; orders: number }>();
  for (const row of rows) {
    const label = channelLabel(row.payment_provider);
    const current = grouped.get(label) || { revenueMicros: 0, orders: 0 };
    current.revenueMicros += toNumber(row.revenue_micros);
    current.orders += toNumber(row.orders);
    grouped.set(label, current);
  }

  const total = [...grouped.values()].reduce(
    (sum, item) => sum + item.revenueMicros,
    0,
  );

  return [...grouped.entries()]
    .map(([label, item]) => ({
      label,
      revenueMicros: item.revenueMicros,
      orders: item.orders,
      sharePct: sharePct(item.revenueMicros, total),
    }))
    .sort(
      (a, b) =>
        b.revenueMicros - a.revenueMicros || b.orders - a.orders,
    );
}

export type ProductSort = "revenue" | "units";

/**
 * Ranking is done in TypeScript from a fixed aggregate, so there is no
 * dynamic ORDER BY anywhere. The two supported keys are the whitelist.
 */
export function sortProducts(
  products: ProductPerformance[],
  sort: ProductSort,
): ProductPerformance[] {
  const copy = [...products];
  if (sort === "units") {
    copy.sort(
      (a, b) => b.units - a.units || b.revenueMicros - a.revenueMicros,
    );
  } else {
    copy.sort(
      (a, b) => b.revenueMicros - a.revenueMicros || b.units - a.units,
    );
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* SQL                                                                 */
/* ------------------------------------------------------------------ */

type KpiWindowKey = "today" | "d7" | "d30" | "month" | "all";

type KpiRow = Record<string, string | null>;

type OpsRow = {
  pending_payment: string;
  pending_amount: string;
  to_procure: string;
  to_deliver: string;
  refund_pending: string;
  refunded: string;
};

type TrendRow = {
  day: string;
  revenue_micros: string;
  cost_micros: string;
  orders: string;
  missing_revenue_micros: string;
};

type ProductAggRow = {
  product_slug: string;
  product_name: string;
  brand: string;
  units: string;
  revenue_micros: string;
  cost_micros: string;
  missing_lines: string;
  line_count: string;
};

type ApiRow = {
  revenue_today: string;
  revenue_30d: string;
  revenue_all: string;
  orders_30d: string;
  orders_all: string;
  pending: string;
};

/**
 * Shared paid-order CTE. Cost is summed from the immutable order-item
 * snapshot (`supplier_cost_micros`), not the supplier's current price.
 * An order is "costed" only when every line has a positive cost.
 */
const PAID_ORDERS_CTE = `
  paid_orders AS (
    SELECT o.id,
           o.amount_micros,
           o.paid_at,
           COALESCE(cost.cost_micros, 0)::bigint AS cost_micros,
           COALESCE(cost.item_count, 0)::bigint AS item_count,
           COALESCE(cost.missing_count, 0)::bigint AS missing_count,
           COALESCE(pre.is_preorder, FALSE) AS is_preorder
      FROM shop_orders o
      LEFT JOIN LATERAL (
        SELECT SUM(supplier_cost_micros)::bigint AS cost_micros,
               COUNT(*)::bigint AS item_count,
               COUNT(*) FILTER (WHERE supplier_cost_micros <= 0)::bigint AS missing_count
          FROM shop_order_items
         WHERE order_id = o.id
      ) cost ON TRUE
      LEFT JOIN LATERAL (
        SELECT TRUE AS is_preorder
          FROM shop_order_items i
          LEFT JOIN shop_products p ON p.id = i.product_id
         WHERE i.order_id = o.id
           AND (lower(i.brand) = 'muse' OR ${preorderSql("p.")})
         LIMIT 1
      ) pre ON TRUE
     WHERE o.status IN (${REVENUE_STATUS_SQL})
       AND o.paid_at IS NOT NULL
  )
`;

const BOUNDS_CTE = `
  bounds AS (
    SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS today_start,
           (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') - INTERVAL '6 days' AS start_7d,
           (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days' AS start_30d,
           (date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS month_start
  )
`;

function windowFilter(key: KpiWindowKey): string {
  switch (key) {
    case "today":
      return "p.paid_at >= b.today_start";
    case "d7":
      return "p.paid_at >= b.start_7d";
    case "d30":
      return "p.paid_at >= b.start_30d";
    case "month":
      return "p.paid_at >= b.month_start";
    case "all":
      return "TRUE";
  }
}

/**
 * Window aggregates. The filter fragments come from windowFilter(), whose
 * only possible outputs are the fixed strings above.
 */
function buildKpiSql(): string {
  const windows: KpiWindowKey[] = ["today", "d7", "d30", "month", "all"];
  const metrics = windows
    .map((key) => {
      const where = windowFilter(key);
      return `
        COALESCE(SUM(p.amount_micros) FILTER (WHERE ${where}), 0)::text AS revenue_${key},
        COALESCE(SUM(p.amount_micros) FILTER (WHERE ${where} AND p.missing_count = 0 AND p.item_count > 0), 0)::text AS costed_revenue_${key},
        COALESCE(SUM(p.cost_micros) FILTER (WHERE ${where} AND p.missing_count = 0 AND p.item_count > 0), 0)::text AS cost_${key},
        COUNT(*) FILTER (WHERE ${where})::text AS orders_${key},
        COUNT(*) FILTER (WHERE ${where} AND (p.missing_count > 0 OR p.item_count = 0))::text AS missing_cost_${key}`;
    })
    .join(",\n");

  return `
    WITH ${PAID_ORDERS_CTE}, ${BOUNDS_CTE}
    SELECT ${metrics},
           COALESCE(SUM(p.amount_micros) FILTER (
             WHERE p.paid_at >= b.start_7d - INTERVAL '7 days' AND p.paid_at < b.start_7d
           ), 0)::text AS revenue_prev_7d,
           COALESCE(SUM(p.amount_micros) FILTER (
             WHERE p.paid_at >= b.start_30d - INTERVAL '30 days' AND p.paid_at < b.start_30d
           ), 0)::text AS revenue_prev_30d,
           COUNT(*) FILTER (
             WHERE p.paid_at >= b.start_30d
               AND p.missing_count = 0
               AND p.item_count > 0
           )::text AS costed_orders_30d,
           COUNT(*) FILTER (
             WHERE p.paid_at >= b.start_30d AND p.is_preorder
           )::text AS preorder_30d
      FROM paid_orders p
      CROSS JOIN bounds b
  `;
}

const OPS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending_payment' AND expires_at > now())::text AS pending_payment,
    COALESCE(SUM(amount_micros) FILTER (WHERE status = 'pending_payment' AND expires_at > now()), 0)::text AS pending_amount,
    COUNT(*) FILTER (WHERE status = 'paid')::text AS to_procure,
    COUNT(*) FILTER (WHERE status = 'procuring')::text AS to_deliver,
    COUNT(*) FILTER (WHERE status = 'refund_pending')::text AS refund_pending,
    COUNT(*) FILTER (WHERE status = 'refunded')::text AS refunded
  FROM shop_orders
`;

const TREND_SQL = `
  WITH ${PAID_ORDERS_CTE}, ${BOUNDS_CTE},
  days AS (
    SELECT generate_series(
             (b.start_30d AT TIME ZONE 'Asia/Shanghai')::date,
             (now() AT TIME ZONE 'Asia/Shanghai')::date,
             INTERVAL '1 day'
           )::date AS day
      FROM bounds b
  )
  SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
         COALESCE(SUM(p.amount_micros), 0)::text AS revenue_micros,
         COALESCE(SUM(p.cost_micros) FILTER (
           WHERE p.missing_count = 0 AND p.item_count > 0
         ), 0)::text AS cost_micros,
         COUNT(p.id)::text AS orders,
         COALESCE(SUM(p.amount_micros) FILTER (
           WHERE p.missing_count > 0 OR p.item_count = 0
         ), 0)::text AS missing_revenue_micros
    FROM days d
    LEFT JOIN paid_orders p
      ON (p.paid_at AT TIME ZONE 'Asia/Shanghai')::date = d.day
   GROUP BY d.day
   ORDER BY d.day
`;

const CHANNEL_SQL = `
  WITH ${BOUNDS_CTE}
  SELECT o.payment_provider,
         COUNT(*)::text AS orders,
         COALESCE(SUM(o.amount_micros), 0)::text AS revenue_micros
    FROM shop_orders o
    CROSS JOIN bounds b
   WHERE o.status IN (${REVENUE_STATUS_SQL})
     AND o.paid_at >= b.start_30d
   GROUP BY o.payment_provider
   ORDER BY SUM(o.amount_micros) DESC
`;

const PRODUCT_SQL = `
  WITH ${BOUNDS_CTE}
  SELECT i.product_slug,
         i.product_name,
         i.brand,
         SUM(i.qty)::text AS units,
         SUM(i.unit_price_micros * i.qty)::text AS revenue_micros,
         COALESCE(SUM(i.supplier_cost_micros), 0)::text AS cost_micros,
         COUNT(*) FILTER (WHERE i.supplier_cost_micros <= 0)::text AS missing_lines,
         COUNT(*)::text AS line_count
    FROM shop_order_items i
    JOIN shop_orders o ON o.id = i.order_id
    CROSS JOIN bounds b
   WHERE o.status IN (${REVENUE_STATUS_SQL})
     AND o.paid_at >= b.start_30d
   GROUP BY i.product_slug, i.product_name, i.brand
`;

const API_RECHARGE_SQL = `
  WITH ${BOUNDS_CTE}
  SELECT
    COALESCE(SUM(o.amount_micros) FILTER (
      WHERE o.status = 'paid' AND o.paid_at >= b.today_start
    ), 0)::text AS revenue_today,
    COALESCE(SUM(o.amount_micros) FILTER (
      WHERE o.status = 'paid' AND o.paid_at >= b.start_30d
    ), 0)::text AS revenue_30d,
    COALESCE(SUM(o.amount_micros) FILTER (WHERE o.status = 'paid'), 0)::text AS revenue_all,
    COUNT(*) FILTER (
      WHERE o.status = 'paid' AND o.paid_at >= b.start_30d
    )::text AS orders_30d,
    COUNT(*) FILTER (WHERE o.status = 'paid')::text AS orders_all,
    COUNT(*) FILTER (WHERE o.status = 'pending')::text AS pending
  FROM orders o
  CROSS JOIN bounds b
`;

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

function readWindow(row: KpiRow, key: KpiWindowKey): WindowMetrics {
  const read = (name: string) => toNumber(row[`${name}_${key}`] ?? 0);
  return {
    revenueMicros: read("revenue"),
    costMicros: read("cost"),
    costedRevenueMicros: read("costed_revenue"),
    orders: read("orders"),
    missingCostOrders: read("missing_cost"),
  };
}

function mapProduct(row: ProductAggRow): ProductPerformance {
  const revenueMicros = toNumber(row.revenue_micros);
  const costMicros = toNumber(row.cost_micros);
  const costKnown = isCostKnown(
    toNumber(row.line_count),
    toNumber(row.missing_lines),
  );
  return {
    slug: row.product_slug,
    name: row.product_name,
    brand: row.brand,
    units: toNumber(row.units),
    revenueMicros,
    costMicros,
    costKnown,
    grossProfitMicros: costKnown ? revenueMicros - costMicros : null,
    marginPct: costKnown ? grossMarginPct(revenueMicros, costMicros) : null,
  };
}

export async function loadShopAnalytics(): Promise<ShopAnalytics> {
  const [kpiResult, opsResult, trendResult, channelResult, productResult, apiResult] =
    await Promise.all([
      query<KpiRow>(buildKpiSql()),
      query<OpsRow>(OPS_SQL),
      query<TrendRow>(TREND_SQL),
      query<ChannelAggRow>(CHANNEL_SQL),
      query<ProductAggRow>(PRODUCT_SQL),
      query<ApiRow>(API_RECHARGE_SQL),
    ]);

  const kpi = kpiResult.rows[0] || {};
  const ops = opsResult.rows[0];
  const api = apiResult.rows[0];

  const products = productResult.rows.map(mapProduct);
  const windows = {
    today: readWindow(kpi, "today"),
    d7: readWindow(kpi, "d7"),
    d30: readWindow(kpi, "d30"),
    month: readWindow(kpi, "month"),
    all: readWindow(kpi, "all"),
  };

  const preorder30d = toNumber(kpi.preorder_30d);
  const orders30d = windows.d30.orders;

  return {
    generatedAt: new Date().toISOString(),
    windows,
    previousRevenue: {
      d7Micros: toNumber(kpi.revenue_prev_7d),
      d30Micros: toNumber(kpi.revenue_prev_30d),
    },
    orders: {
      costed30d: toNumber(kpi.costed_orders_30d),
      missingCost30d: windows.d30.missingCostOrders,
      missingCostAll: windows.all.missingCostOrders,
      preorder30d,
      preorderSharePct: sharePct(preorder30d, orders30d),
      aov30dMicros: averageOrderValue(windows.d30.revenueMicros, orders30d),
    },
    operations: {
      pendingPayment: toNumber(ops?.pending_payment),
      pendingPaymentAmountMicros: toNumber(ops?.pending_amount),
      toProcure: toNumber(ops?.to_procure),
      toDeliver: toNumber(ops?.to_deliver),
      refundPending: toNumber(ops?.refund_pending),
      refunded: toNumber(ops?.refunded),
    },
    trend: trendResult.rows.map((row) => ({
      day: row.day,
      revenueMicros: toNumber(row.revenue_micros),
      costMicros: toNumber(row.cost_micros),
      orders: toNumber(row.orders),
      missingRevenueMicros: toNumber(row.missing_revenue_micros),
    })),
    channels: buildChannelSlices(channelResult.rows),
    productsByRevenue: sortProducts(products, "revenue").slice(0, 10),
    productsByUnits: sortProducts(products, "units").slice(0, 10),
    apiRecharge: {
      revenueTodayMicros: toNumber(api?.revenue_today),
      revenue30dMicros: toNumber(api?.revenue_30d),
      revenueAllMicros: toNumber(api?.revenue_all),
      orders30d: toNumber(api?.orders_30d),
      ordersAll: toNumber(api?.orders_all),
      pending: toNumber(api?.pending),
      aov30dMicros: averageOrderValue(
        toNumber(api?.revenue_30d),
        toNumber(api?.orders_30d),
      ),
    },
  };
}

export { readWindow };
