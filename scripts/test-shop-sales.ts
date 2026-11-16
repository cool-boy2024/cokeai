import {
  normalizeSupplierStock,
  productAvailabilityState,
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
assertEqual(abundant.abundant, true, "充足 is flagged as in stock");
assertEqual(abundant.soldOut, false, "充足 is never sold out");
assertEqual(
  salesLabel(abundant),
  "已售 10673 · 现货充足",
  "充足 says 现货充足 instead of inventing a number",
);

// 货源充足但还没有销量：只写「现货充足」，不显示「已售 0」。
const abundantNoSales = salesDisplay({ supplierSold: 0, supplierStock: -1 });
assertEqual(salesLabel(abundantNoSales), "现货充足", "abundant with no sales");

// --- 货源售罄：页面转缺货、下单要拦 ---------------------------------------

const soldOut = salesDisplay({ supplierSold: 88, supplierStock: 0 });
assertEqual(soldOut.remaining, 0, "zero stock is a real zero");
assertEqual(soldOut.soldOut, true, "zero stock means sold out");
assertEqual(salesLabel(soldOut), "已售 88 · 已售罄", "sold-out label");

// --- 什么都没有：不显示 ---------------------------------------------------

// 货源没给任何信息时才是空白。
const nothing = salesDisplay({ supplierSold: 0, supplierStock: 0 });
assertEqual(salesLabel(nothing), "已售罄", "zero stock with no sales still shows sold out");

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

// --- 「补货中」绝不能跟着「现货充足」 -------------------------------------

// 商品被停售/补货中，但货源标了「充足」：只保留已售，不写库存。
assertEqual(
  salesLabel(abundant, { available: false }),
  "已售 10673",
  "unavailable product must not advertise 现货充足",
);
assertEqual(
  salesLabel(inStock, { available: false }),
  "已售 88",
  "unavailable product must not advertise 库存 N",
);
// 售罄是事实，停售时仍然要说。
assertEqual(
  salesLabel(soldOut, { available: false }),
  "已售 88 · 已售罄",
  "sold out is still reported when unavailable",
);

// 可售判断与徽标必须同源。
assertEqual(
  productAvailabilityState({ availability: "in_stock" }),
  "available",
  "in_stock is buyable",
);
assertEqual(
  productAvailabilityState({ availability: "out_of_stock" }),
  "unavailable",
  "out_of_stock is not buyable",
);
assertEqual(
  productAvailabilityState({ availability: "out_of_stock", preorder: true }),
  "available",
  "preorder stays buyable",
);
assertEqual(
  productAvailabilityState({ availability: "in_stock", soldOut: true }),
  "unavailable",
  "supplier zero stock overrides in_stock",
);

console.log("shop sales: ok");
