/**
 * Static brand list must hide 月饼科技社 / ybkjs / baipiao even when the
 * caller does not pass a store identity. No database.
 */
import assert from "node:assert/strict";
import { sanitizeSupplierCopy } from "../src/lib/shop/sanitize";

const sentences = [
  "欢迎来到月饼科技社，下单后按商品说明发货。",
  "教程见 fk.ybkjs.top，店铺代号 ybkjs。",
  "兑换地址 baipiao.org，按页面提示操作。",
];

const leaks = ["月饼科技社", "ybkjs", "baipiao.org", "fk.ybkjs.top"];

for (const raw of sentences) {
  const clean = sanitizeSupplierCopy(raw);
  for (const leak of leaks) {
    assert.equal(
      clean.includes(leak),
      false,
      `${JSON.stringify(raw)} still contains ${leak}: ${clean}`,
    );
  }
}

console.log("test-sanitize-suppliers: ok");
