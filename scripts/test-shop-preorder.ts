/**
 * Pure-function tests for supplier preorder (预定单) detection and copy.
 * No database and no network: every fixture below mirrors a real zyanai
 * detail payload observed on 2026-11-14.
 */
import {
  availabilityLabel,
  deliveryLabel,
  etaLabel,
  isPurchasable,
} from "../src/lib/shop/copy";
import {
  PREORDER_BRANDS,
  PREORDER_MARKER,
  hasActiveReservationNotice,
  isPreorderBrand,
  isPreorderStock,
  preorderSql,
} from "../src/lib/shop/preorder";
import { parseItemPage, toProduct, type ZyanaiItem } from "../src/lib/shop/zyanai";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

// --- Operated brands are always preorder ----------------------------------

assert(PREORDER_BRANDS.includes("muse"), "muse is an operated preorder brand");
assert(isPreorderBrand("muse"), "muse brand is a preorder");
assert(isPreorderBrand(" Muse "), "brand matching is trimmed and case-insensitive");
assert(!isPreorderBrand("chatgpt"), "chatgpt is not forced into preorder");
assert(!isPreorderBrand(null), "missing brand is not a preorder brand");
assert(
  preorderSql("p.").includes("p.availability_reason") &&
    preorderSql("p.").includes("p.brand") &&
    preorderSql("p.").includes("'muse'"),
  "SQL predicate covers the supplier marker and Muse brand",
);
assert(
  preorderSql("p.").includes("p.preorder_manual = TRUE"),
  "operator-forced preorder is part of the derived boolean",
);

// --- Stock signal rule -----------------------------------------------------

// Item 513: 已售罄 / stock_raw 0 / reservations enabled → preorder.
assert(
  isPreorderStock({
    reservation_enabled: 1,
    is_stock: false,
    stock_state: 0,
    stock_raw: 0,
  }),
  "zero stock with reservations enabled is a preorder",
);

// Item 84: stock_raw 7, still purchasable → normal stock.
assert(
  !isPreorderStock({
    reservation_enabled: 1,
    is_stock: true,
    stock_state: 1,
    stock_raw: 7,
  }),
  "a listing with stock is not a preorder",
);

// Item 51: lots of stock, reservation capability enabled → not a preorder.
assert(
  !isPreorderStock({
    reservation_enabled: 1,
    is_stock: true,
    stock_state: 1,
    stock_raw: 376,
  }),
  "reservation_enabled alone must not mark a listing as preorder",
);

// Manual-delivery items use a 9,999,xxx sentinel and disable reservations.
assert(
  !isPreorderStock({
    reservation_enabled: 0,
    is_stock: true,
    stock_state: 1,
    stock_raw: 9_999_620,
  }),
  "manual-delivery sentinel stock is not a preorder",
);

// Sold out but reservations disabled → ordinary out of stock.
assert(
  !isPreorderStock({
    reservation_enabled: 0,
    is_stock: false,
    stock_state: 0,
    stock_raw: 0,
  }),
  "sold out without reservation support is not a preorder",
);

// Missing detail JSON must fall back to "not preorder".
assert(!isPreorderStock({}), "missing signals are not a preorder");

// String payloads are tolerated.
assert(
  isPreorderStock({
    reservation_enabled: "1",
    is_stock: "false",
    stock_state: "0",
    stock_raw: "0",
  }),
  "string stock flags are parsed",
);

// --- Rendered banner -------------------------------------------------------

const ACTIVE_HTML =
  '<div class="tokyo-reservation-notice is-active" data-reservation-notice></div>';
const INACTIVE_HTML =
  '<div class="tokyo-reservation-notice " data-reservation-notice></div>';
assert(hasActiveReservationNotice(ACTIVE_HTML), "active reservation banner detected");
assert(
  !hasActiveReservationNotice(INACTIVE_HTML),
  "inactive banner is present on every product and must not count",
);
assert(
  hasActiveReservationNotice('<div class="theme-x is-active tokyo-reservation-notice"></div>'),
  "class order does not matter",
);
assert(
  !hasActiveReservationNotice("<div data-reservation-notice></div>"),
  "the data attribute alone is not an active banner",
);

// --- Detail page parsing ---------------------------------------------------

const pageHtml = `<script>
  window.setVar("_var_item", {"id":513,"name":"Gemini 成品账号","price":"25","stock":"已售罄","stock_raw":0,"is_stock":false,"stock_state":0,"reservation_enabled":1,"delivery_way":0});
</script>
<div class="tokyo-reservation-notice is-active" data-reservation-notice></div>`;
const parsed = parseItemPage(pageHtml);
assert(parsed.item?.id === 513, "detail JSON parsed");
assert(parsed.reservationActive, "detail page reservation state parsed");

// --- Product mapping -------------------------------------------------------

const preorderItem: ZyanaiItem = {
  id: 513,
  name: "Gemini 成品账号",
  price: "25",
  stock: "已售罄",
  stock_raw: 0,
  is_stock: false,
  stock_state: 0,
  reservation_enabled: 1,
  delivery_way: 0,
};
const preorderProduct = toProduct(preorderItem, "");
assert(preorderProduct.preorder, "sold-out reservable item becomes preorder");
assert(
  preorderProduct.availability === "low_stock",
  "preorder stays purchasable instead of showing 补货中",
);
assert(isPurchasable(preorderProduct.availability), "preorder is purchasable");

const inStockItem: ZyanaiItem = {
  id: 51,
  name: "GPT PLUS 官方直充",
  price: "118",
  stock: "非常多",
  stock_raw: 376,
  is_stock: true,
  stock_state: 1,
  reservation_enabled: 1,
  delivery_way: 0,
};
const inStockProduct = toProduct(inStockItem, "");
assert(!inStockProduct.preorder, "in-stock item stays in stock");
assert(inStockProduct.availability === "in_stock", "in-stock mapping unchanged");

const soldOutItem: ZyanaiItem = {
  id: 900,
  name: "已售罄且不支持预订",
  price: "10",
  stock: "已售罄",
  stock_raw: 0,
  is_stock: false,
  stock_state: 0,
  reservation_enabled: 0,
  delivery_way: 0,
};
const soldOutProduct = toProduct(soldOutItem, "");
assert(!soldOutProduct.preorder, "sold-out without reservation is not preorder");
assert(soldOutProduct.availability === "out_of_stock", "sold-out mapping unchanged");

// The rendered banner wins over an inconclusive JSON payload.
const overridden = toProduct(
  { id: 901, name: "x", price: "1", stock: "充足" },
  "",
  { preorder: true },
);
assert(overridden.preorder, "explicit preorder override is honoured");
assert(overridden.availability === "low_stock", "override keeps the item purchasable");

// --- Storefront copy -------------------------------------------------------

assert(PREORDER_MARKER === "preorder", "database marker is stable");
assert(availabilityLabel("low_stock", true) === "预定", "preorder availability copy");
assert(availabilityLabel("low_stock") === "库存紧张", "normal availability copy");
assert(deliveryLabel("manual", true) === "人工处理", "preorder delivery copy");
assert(deliveryLabel("manual") === "人工发货", "normal delivery copy");
assert(
  etaLabel(15, 60, true) === "按预定顺序发货",
  "preorder must not promise a delivery window",
);
assert(etaLabel(15, 60) === "15 至 60 分钟发货", "normal ETA copy unchanged");
assert(etaLabel(0, 0) === "尽快发货", "zero ETA copy unchanged");

console.log("test-shop-preorder: ok");
