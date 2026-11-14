import { startingPriceMicros, type ShopVariant } from "../src/lib/shop/variants";

/**
 * Pure checks for selectable options ("宝贝类型"). No database required:
 * `npm run test:shop:variants`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT: ${message} (expected ${expected}, got ${actual})`);
  }
}

function variant(id: string, price: number, sort = 0): ShopVariant {
  return {
    id,
    variant_key: id,
    label: id,
    badge: "",
    price_micros: price,
    warranty_type: "first_login",
    warranty_days: 0,
    warranty_note: "",
    availability: "in_stock",
    preorder: false,
    sort_order: sort,
  };
}

// No options: the product's own price is the only price.
assertEqual(
  startingPriceMicros({ price_micros: 10_000_000, variants: [] }),
  10_000_000,
  "no variants uses base price",
);
assertEqual(
  startingPriceMicros({ price_micros: 10_000_000 }),
  10_000_000,
  "missing variants field uses base price",
);

// Options: list cards advertise the cheapest one, regardless of order.
assertEqual(
  startingPriceMicros({
    price_micros: 30_000_000,
    variants: [variant("a", 30_000_000), variant("b", 12_000_000), variant("c", 20_000_000)],
  }),
  12_000_000,
  "cheapest variant wins",
);

// A zero-priced option is not a real option and must not advertise "0 元起".
assertEqual(
  startingPriceMicros({
    price_micros: 10_000_000,
    variants: [variant("free", 0), variant("paid", 15_000_000)],
  }),
  15_000_000,
  "zero-priced variant ignored",
);

// Member pricing lowers variant prices in place; the helper sees the lower set.
assertEqual(
  startingPriceMicros({
    price_micros: 10_000_000,
    variants: [
      { ...variant("a", 8_500_000), list_price_micros: 10_000_000 },
      variant("b", 25_500_000),
    ],
  }),
  8_500_000,
  "discounted variant price is used",
);

console.log("shop variants: ok");
