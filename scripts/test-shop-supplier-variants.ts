import { parseSupplierVariants } from "../src/lib/shop/supplier-variants";

/**
 * Pure checks for supplier option parsing. No database or network required:
 * `npm run test:shop:supplier-variants`.
 *
 * Fixtures mirror the real Tokyo-theme product JSON the storefronts embed as
 * `setVar("_var_item", {...})`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT: ${message}\n  expected ${e}\n  got      ${a}`);
}

function page(item: Record<string, unknown>): string {
  return `<html><body><script>setVar("_var_item", ${JSON.stringify(item)});</script></body></html>`;
}

// item/84: two options, prices are supplier cost (元).
assertEqual(
  parseSupplierVariants(
    page({
      id: 84,
      price: "89.00",
      config: { category: { "plus（质保全程）": "89.00", "plus（质保首登）": "81.00" } },
      stock: "已售罄",
    }),
  ),
  [
    { label: "plus（质保全程）", costMicros: 89_000_000 },
    { label: "plus（质保首登）", costMicros: 81_000_000 },
  ],
  "item/84 two options",
);

// item/51: four options plus a wholesale map that must be ignored.
assertEqual(
  parseSupplierVariants(
    page({
      id: 51,
      config: {
        category: {
          "渠道1:质保开通卡密": "131.00",
          "渠道1:质保全程卡密": "131.00",
          "渠道3:质保开通卡密": "146.50",
          "渠道3:质保全程卡密": "146.50",
        },
        category_wholesale: { "渠道1:质保开通卡密": "100.00" },
      },
    }),
  ).length,
  4,
  "item/51 four options, wholesale ignored",
);

// item/127: numeric-looking labels.
assertEqual(
  parseSupplierVariants(
    page({ id: 127, config: { category: { "5x": "875.00", "20x": "1848.00" } } }),
  ),
  [
    { label: "5x", costMicros: 875_000_000 },
    { label: "20x", costMicros: 1_848_000_000 },
  ],
  "item/127 options",
);

// item/513: wholesale-only config, no category -> no buyer options.
assertEqual(
  parseSupplierVariants(
    page({ id: 513, config: { wholesale: { "5": "47.50", "100": "47.00" } } }),
  ),
  [],
  "item/513 wholesale-only yields none",
);

// item/515: config is an empty array -> none.
assertEqual(parseSupplierVariants(page({ id: 515, config: [] })), [], "empty config array");

// No inline product JSON (other theme / blocked page) -> none.
assertEqual(parseSupplierVariants("<html><body>hello</body></html>"), [], "no marker");

// Bad prices and blank/duplicate labels are dropped.
assertEqual(
  parseSupplierVariants(
    page({ config: { category: { "  ": "9.00", A: "0", B: "abc", C: "12.00", "C ": "13.00" } } }),
  ),
  [{ label: "C", costMicros: 12_000_000 }],
  "invalid rows dropped, duplicate label collapses",
);

// Option list is capped at 30.
const many: Record<string, string> = {};
for (let i = 0; i < 40; i += 1) many[`opt-${i}`] = String(10 + i);
assertEqual(
  parseSupplierVariants(page({ config: { category: many } })).length,
  30,
  "capped at 30 options",
);

// config can be an object without category (e.g. only wholesale) -> none.
assertEqual(parseSupplierVariants(page({ config: {} })), [], "config without category");

console.log("shop supplier variants: ok");
