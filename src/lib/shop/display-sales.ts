import { query } from "@/lib/db";
import { preorderSql } from "./preorder";
import { supplierStockSoldOut } from "./sales-display";

/**
 * 商品页的货源库存 / 已售。
 *
 * 两个数字直接存在商品行上（`supplier_sold` / `supplier_stock`），由每次货源
 * 同步刷新。页面读取时不查询订单、不做任何推算，所以页面上看到的数字永远
 * 和上游一致：上游没货，我们就不卖。预定单除外——库存 0 仍可预订。
 *
 * 纯计算在 sales-display.ts，那是客户端组件也能引用的无数据库版本。
 */

export type { ShopSalesDisplay } from "./sales-display";
export { salesDisplay, salesLabel, coarseSold, normalizeSupplierStock } from "./sales-display";

type StockRow = {
  units: string | number;
  batch_units: string | number;
};

/**
 * 货源断货的商品不能被售出。
 *
 * 放在下单入口而不是只是个页面提示：库存可能是同步之后才降到 0 的，
 * 页面还停在旧数据上。返回 true 表示「货源已无货」。
 */
export async function isSupplierOutOfStock(productId: string): Promise<boolean> {
  try {
    const rows = await query<{ supplier_stock: number; preorder: boolean }>(
      `SELECT supplier_stock, ${preorderSql()} AS preorder
         FROM shop_products WHERE id = $1 LIMIT 1`,
      [productId],
    );
    const row = rows.rows[0];
    if (!row) return false;
    return supplierStockSoldOut(Number(row.supplier_stock), Boolean(row.preorder));
  } catch {
    // 读不到就按「有货」处理：供应商库存缺失不该把整个下单流程堵死。
    return false;
  }
}
