// 当天已付款订单。不返回邮箱、金额、订单号。

import { query } from "@/lib/db";
import { preorderSql } from "@/lib/shop/preorder";

export type TickerItem = {
  id: string;
  nth: number;
  name: string;
  soldToday: number;
  stock: number | null;
  preorder: boolean;
};

type OrderRow = {
  id: string;
  name: string;
  qty: number;
  supplier_stock: number | null;
  preorder: boolean;
};

const PAID_STATUSES = ["paid", "procuring", "delivered", "refund_pending"];

function shortName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
}

function nameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function stockCount(stock: number | null): number | null {
  const value = Number(stock);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

export async function listTickerItems(now = new Date()): Promise<TickerItem[]> {
  const orders = await query<OrderRow>(
    `SELECT o.id, i.product_name AS name, i.qty, p.supplier_stock,
            ${preorderSql("p.")} AS preorder
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
       LEFT JOIN shop_products p ON p.id = i.product_id
      WHERE o.status = ANY($1::text[])
        AND o.paid_at IS NOT NULL
        AND (o.paid_at AT TIME ZONE 'Asia/Shanghai')::date
            = ($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
      ORDER BY o.paid_at ASC, i.id ASC
      LIMIT 40`,
    [PAID_STATUSES, now.toISOString()],
  );

  const soldByName = new Map<string, number>();
  for (const row of orders.rows) {
    const qty = Math.max(1, Math.trunc(Number(row.qty) || 1));
    const key = nameKey(row.name);
    soldByName.set(key, (soldByName.get(key) ?? 0) + qty);
  }

  const nthByOrder = new Map<string, number>();
  let nextNth = 0;
  return orders.rows.map((row, index) => {
    let nth = nthByOrder.get(row.id);
    if (nth === undefined) {
      nextNth += 1;
      nth = nextNth;
      nthByOrder.set(row.id, nth);
    }
    const preorder = Boolean(row.preorder);
    return {
      id: `paid-${nth}-${index}`,
      nth,
      name: shortName(row.name),
      soldToday: soldByName.get(nameKey(row.name)) ?? 0,
      stock: preorder ? null : stockCount(row.supplier_stock),
      preorder,
    };
  });
}
