import { salesDisplay, salesLabel } from "../src/lib/shop/sales-display";

/**
 * Pure-function checks for the storefront sales / batch counters.
 * No database required: `npm run test:shop:sales`.
 *
 * 页面口径：已售 = 历史基数 + 本站已付款件数；库存还剩 = 本批次放量 − 本批次
 * 已付款件数。真实订单自动加减，批次卖完显示「本批次已售完」。
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  }
}

// --- 基准：还没有任何本站订单 ----------------------------------------------

const fresh = salesDisplay({ soldBaseline: 78, batchSize: 14, paidUnits: 0 });
assertEqual(fresh.sold, 78, "no orders yet keeps the baseline");
assertEqual(fresh.remaining, 14, "a fresh batch shows its full size");
assertEqual(fresh.soldOut, false, "a fresh batch is not sold out");
assertEqual(salesLabel(fresh), "已售 78 · 库存还剩 14", "label reads as designed");

// --- 真实成交：已售 +1、库存 −1 -------------------------------------------

const oneOrder = salesDisplay({ soldBaseline: 78, batchSize: 14, paidUnits: 1, batchUnits: 1 });
assertEqual(oneOrder.sold, 79, "a paid order increments 已售");
assertEqual(oneOrder.remaining, 13, "a paid order decrements 库存还剩");
assertEqual(salesLabel(oneOrder), "已售 79 · 库存还剩 13", "label tracks the order");

// 数量 2 的一单同样扣 2
const qtyTwo = salesDisplay({ soldBaseline: 0, batchSize: 10, paidUnits: 2, batchUnits: 2 });
assertEqual(qtyTwo.sold, 2, "qty 2 counts twice in 已售");
assertEqual(qtyTwo.remaining, 8, "qty 2 counts twice in 库存");

// --- 跨批次：历史订单不占新批次的量 ---------------------------------------

const secondBatch = salesDisplay({
  soldBaseline: 78,
  batchSize: 14,
  paidUnits: 20, // 累计：上一批卖了 6 + 这一批 14
  batchUnits: 14, // 本批已满
});
assertEqual(secondBatch.sold, 98, "已售 keeps counting across batches");
assertEqual(secondBatch.remaining, 0, "a new batch has its own count");
assertEqual(secondBatch.soldOut, true, "the current batch is exhausted");

// --- 售罄：剩余不会变负数 -------------------------------------------------

const oversold = salesDisplay({ soldBaseline: 0, batchSize: 3, paidUnits: 5, batchUnits: 5 });
assertEqual(oversold.remaining, 0, "remaining never goes negative");
assertEqual(oversold.soldOut, true, "past the batch size is sold out");
assertEqual(salesLabel(oversold), "已售 5 · 本批次已售完", "sold-out label");

// --- 未启用批次：只显示已售 -----------------------------------------------

const unlimited = salesDisplay({ soldBaseline: 10, batchSize: 0, paidUnits: 3 });
assertEqual(unlimited.remaining, null, "batch_size 0 means no batch limit");
assertEqual(unlimited.soldOut, false, "no batch can never be sold out");
assertEqual(salesLabel(unlimited), "已售 13", "only 已售 is shown");

// --- 什么都没配：不显示任何计数 -------------------------------------------

const empty = salesDisplay({ soldBaseline: 0, batchSize: 0, paidUnits: 0 });
assertEqual(salesLabel(empty), "", "a product with no counter renders no label");

// 新开批次但一件没卖：也不该写「已售 0」，否则满屏都是 0。
const newBatch = salesDisplay({ soldBaseline: 0, batchSize: 50, paidUnits: 0, batchUnits: 0 });
assertEqual(newBatch.remaining, 50, "a fresh batch still tracks its remainder");
assertEqual(salesLabel(newBatch), "", "a fresh batch with no sales shows no label");

// 卖出去第一件之后才出现计数。
const firstSale = salesDisplay({ soldBaseline: 0, batchSize: 50, paidUnits: 1, batchUnits: 1 });
assertEqual(salesLabel(firstSale), "已售 1 · 库存还剩 49", "the label appears on the first sale");

// --- 脏输入：负数 / NaN / 缺省 --------------------------------------------

const dirty = salesDisplay({
  soldBaseline: Number.NaN,
  batchSize: -5,
  paidUnits: Number.NaN,
});
assertEqual(dirty.sold, 0, "NaN baseline and paid count read as zero");
assertEqual(dirty.remaining, null, "a negative batch size disables the batch");

const negative = salesDisplay({ soldBaseline: -10, batchSize: 5, paidUnits: -2 });
assertEqual(negative.sold, 0, "negative counters are clamped to zero");
assertEqual(negative.remaining, 5, "negative paid units do not inflate the batch");

// 未传 batchUnits 时按累计件数计算（老数据、单批次商品的兜底）
const noBatchUnits = salesDisplay({ soldBaseline: 5, batchSize: 10, paidUnits: 4 });
assertEqual(noBatchUnits.remaining, 6, "batchUnits defaults to paidUnits");
assertEqual(noBatchUnits.sold, 9, "已售 still uses lifetime paid units");

console.log("shop sales: ok");
