import { parseAibijiaFeed, offerKey } from "../src/lib/shop/sync";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const feed = {
  products: [
    {
      slug: "chatgpt",
      name: "ChatGPT",
      offers: [
        {
          source_store_name: "Tokyo",
          platform_name: "LDXP",
          source_title: "GPT PLUS 卡密",
          price: 132,
          currency: "CNY",
          status: "in_stock",
          url: "https://example.com/item/a",
        },
        {
          source_store_name: "Tokyo",
          platform_name: "LDXP",
          source_title: "GPT PLUS 卡密 备用",
          price: 145.5,
          currency: "CNY",
          status: "low_stock",
          url: "https://example.com/item/a",
        },
        {
          source_store_name: "Bad",
          source_title: "missing url",
          price: 1,
          status: "in_stock",
          url: "",
        },
        {
          source_store_name: "Bad",
          source_title: "bad price",
          price: 0,
          status: "in_stock",
          url: "https://example.com/item/b",
        },
      ],
    },
  ],
};

const meta = { offer_count: 2, products_sha256: "a".repeat(64) };
const parsed = parseAibijiaFeed(feed, meta);

assert(parsed.productsSeen === 1, "products seen");
assert(parsed.offers.length === 2, "invalid offers were not dropped");
assert(parsed.offerCountMatch, "offer count mismatch");
assert(parsed.offers[0].availability === "in_stock", "status mapping");
assert(parsed.offers[1].availability === "low_stock", "status mapping 2");
assert(parsed.offers[0].price_micros === 132_000_000, "price conversion");
assert(
  parsed.offers[0].external_key !== parsed.offers[1].external_key,
  "same URL with different titles must not collapse",
);
assert(
  offerKey("https://example.com/item/a", "GPT PLUS 卡密") ===
    parsed.offers[0].external_key,
  "offer key is not stable",
);

const unknownStatus = parseAibijiaFeed(
  {
    products: [
      {
        slug: "x",
        name: "X",
        offers: [
          {
            source_title: "x",
            source_store_name: "x",
            price: 1,
            status: "mystery",
            url: "https://example.com/x",
          },
        ],
      },
    ],
  },
  { offer_count: 1, products_sha256: "b".repeat(64) },
);
assert(unknownStatus.offers[0].availability === "out_of_stock", "unknown status mapping");

console.log(
  JSON.stringify(
    {
      ok: true,
      offers: parsed.offers.length,
      keys_unique: parsed.offers[0].external_key !== parsed.offers[1].external_key,
      price_micros: parsed.offers[0].price_micros,
    },
    null,
    2,
  ),
);
