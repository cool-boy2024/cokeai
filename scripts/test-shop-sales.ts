import {
  normalizeSupplierStock,
  salesDisplay,
  salesLabel,
} from "../src/lib/shop/sales-display";

/**
 * Pure-function checks for the storefront sales / stock counters.
 * No database required: `npm run test:shop:sales`.
 *
 * 页面上的两个数字都来自货源公开数据：已售 = 上游累计已售，
 * 库存 = 上游当前库存。货源没货我们就不卖，所以库存 0 必须拦住下单。
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  }
}

// --- 上游 stock 文本收敛 ---------------------------------------------------

assertEqual(normalizeSupplierStock(9), 9, "a number passes through");
assertEqual(normalizeSupplierStock("9"), 9, "a digit string becomes a number");
assertEqual(normalizeSupplierStock(0), 0, "zero stays zero");
assertEqual(normalizeSupplierStock("充足"), -1, "充足 has no count");
assertEqual(normalizeSupplierStock("非常多"), -1, "非常多 has no count");
assertEqual(normalizeSupplierStock("无限"), -1, "无限 has no count");
assertEqual(normalizeSupplierStock("售罄"), 0, "售罄 means out of stock");
assertEqual(normalizeSupplierStock("缺货"), 0, "缺货 means out of stock");
assertEqual(normalizeSupplierStock(null), -1, "missing stock is not sold out");
assertEqual(normalizeSupplierStock(undefined), -1, "undefined stock is not sold out");

// --- 正常商品：数字全部来自货源 -------------------------------------------

const inStock = salesDisplay({ supplierSold: 88, supplierStock: 9 });
assertEqual(inStock.sold, 88, "已售 comes from the supplier");
assertEqual(inStock.remaining, 9, "库存 comes from the supplier");
assertEqual(inStock.soldOut, false, "9 left is not sold out");
assertEqual(salesLabel(inStock), "已售 88 · 库存 9", "label reads as designed");

// --- 库存充足：只显示已售，不编数字 ---------------------------------------

const abundant = salesDisplay({ supplierSold: 10673, supplierStock: -1 });
assertEqual(abundant.remaining, null, "充足 has no number to show");
assertEqual(abundant.soldOut, false, "充足 is never sold out");
assertEqual(salesLabel(abundant), "已售 10673", "no invented stock number");

// --- 货源售罄：页面转缺货、下单要拦 ---------------------------------------

const soldOut = salesDisplay({ supplierSold: 88, supplierStock: 0 });
assertEqual(soldOut.remaining, 0, "zero stock is a real zero");
assertEqual(soldOut.soldOut, true, "zero stock means sold out");
assertEqual(salesLabel(soldOut), "已售 88 · 已售罄", "sold-out label");

// --- 什么都没有：不显示 ---------------------------------------------------

const nothing = salesDisplay({ supplierSold: 0, supplierStock: -1 });
assertEqual(salesLabel(nothing), "", "no sold count and no stock shows nothing");

// --- 脏输入 ---------------------------------------------------------------

const dirty = salesDisplay({
  supplierSold: Number.NaN,
  supplierStock: Number.NaN,
});
assertEqual(dirty.sold, 0, "NaN sold count reads as zero");
assertEqual(dirty.soldOut, false, "NaN stock is not treated as sold out");

const negative = salesDisplay({ supplierSold: -5, supplierStock: -3 });
assertEqual(negative.sold, 0, "negative sold count is clamped");
assertEqual(negative.remaining, null, "any negative stock means 充足");

console.log("shop sales: ok");
