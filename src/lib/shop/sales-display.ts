/**
 * 商品页展示口径的纯函数。
 *
 * 放在这个文件里是因为客户端组件（BuyForm）也要用它：这里不能 import
 * 任何数据库代码，否则 `pg` 会被打进浏览器包。
 */

export type ShopSalesDisplay = {
  /** 已售总件数：历史基数 + 本站已付款件数。 */
  sold: number;
  /** 本批次剩余件数；null 表示未启用批次限量。 */
  remaining: number | null;
  /** 批次已售罄（remaining === 0）。 */
  soldOut: boolean;
};

export function salesDisplay(input: {
  soldBaseline: number;
  batchSize: number;
  paidUnits: number;
  batchUnits?: number;
}): ShopSalesDisplay {
  const baseline = Number.isFinite(input.soldBaseline)
    ? Math.max(0, Math.trunc(input.soldBaseline))
    : 0;
  const batch = Number.isFinite(input.batchSize)
    ? Math.max(0, Math.trunc(input.batchSize))
    : 0;
  const paid = Number.isFinite(input.paidUnits) ? Math.max(0, Math.trunc(input.paidUnits)) : 0;
  const inBatch = Number.isFinite(input.batchUnits)
    ? Math.max(0, Math.trunc(input.batchUnits as number))
    : paid;
  return {
    sold: baseline + paid,
    // Never show a negative remainder: once the batch is gone it stays at 0
    // (补货中) until the operator opens a new batch or auto-refill fires.
    remaining: batch > 0 ? Math.max(0, batch - inBatch) : null,
    soldOut: batch > 0 && batch - inBatch <= 0,
  };
}

/**
 * One-line storefront label, e.g. 「已售 85 · 库存还剩 7」.
 *
 * Nothing sold and no baseline → nothing to say. 「已售 0」 on every row reads
 * worse than no counter at all, and a fresh batch only earns a mention once
 * it has either sold something or has a real history behind it.
 */
export function salesLabel(display: ShopSalesDisplay): string {
  if (display.sold <= 0) return "";
  const parts = [`已售 ${display.sold}`];
  if (display.remaining !== null) {
    parts.push(
      display.remaining > 0 ? `库存还剩 ${display.remaining}` : "本批次已售完",
    );
  }
  return parts.join(" · ");
}
