/**
 * Pure analytics tests. No database and no production data: the script only
 * exercises the formulas exported from src/lib/shop/analytics.ts.
 */
import assert from "node:assert/strict";
import {
  averageOrderValue,
  buildChannelSlices,
  channelLabel,
  deltaPct,
  grossMarginPct,
  isCostKnown,
  readWindow,
  sharePct,
  sortProducts,
  type ProductPerformance,
} from "../src/lib/shop/analytics";

function product(
  overrides: Partial<ProductPerformance> & { slug: string },
): ProductPerformance {
  return {
    name: overrides.slug,
    brand: "other",
    units: 0,
    revenueMicros: 0,
    costMicros: 0,
    costKnown: true,
    grossProfitMicros: 0,
    marginPct: 100,
    ...overrides,
  };
}

function main() {
  // Cost is only known when there is at least one line and every line has a
  // positive snapshot. Zero/negative means the cost was never recorded.
  assert.equal(isCostKnown(2, 0), true);
  assert.equal(isCostKnown(2, 1), false);
  assert.equal(isCostKnown(0, 0), false);

  assert.equal(grossMarginPct(10_000_000, 4_000_000), 60);
  assert.equal(grossMarginPct(10_000_000, 12_000_000), -20);
  assert.equal(grossMarginPct(0, 0), null);

  assert.equal(averageOrderValue(30_000_000, 3), 10_000_000);
  assert.equal(averageOrderValue(30_000_000, 0), null);

  assert.equal(deltaPct(120, 100), 20);
  assert.equal(deltaPct(80, 100), -20);
  assert.equal(deltaPct(100, 0), null);

  assert.equal(sharePct(25, 100), 25);
  assert.equal(sharePct(5, 0), 0);

  assert.equal(channelLabel("alipay_manual"), "支付宝（人工）");
  assert.equal(channelLabel("usdt_bsc"), "USDT · BEP20");
  assert.equal(channelLabel("balance"), "账户余额");
  assert.equal(channelLabel("some_new_provider"), "其它");

  const channels = buildChannelSlices([
    { payment_provider: "usdt_trc20", orders: "2", revenue_micros: "60000000" },
    { payment_provider: "alipay_manual", orders: "1", revenue_micros: "30000000" },
    { payment_provider: "stripe", orders: "1", revenue_micros: "5000000" },
    { payment_provider: "legacy", orders: "1", revenue_micros: "5000000" },
  ]);
  assert.equal(channels.length, 3);
  assert.equal(channels[0].label, "USDT · TRC20");
  assert.equal(channels[0].sharePct, 60);
  const other = channels.find((item) => item.label === "其它");
  assert.ok(other);
  assert.equal(other?.orders, 2);
  assert.equal(other?.revenueMicros, 10_000_000);

  const products = [
    product({ slug: "a", units: 2, revenueMicros: 100_000_000 }),
    product({ slug: "b", units: 10, revenueMicros: 50_000_000 }),
    product({ slug: "c", units: 5, revenueMicros: 75_000_000 }),
  ];
  const byRevenue = sortProducts(products, "revenue");
  assert.deepEqual(
    byRevenue.map((item) => item.slug),
    ["a", "c", "b"],
  );
  const byUnits = sortProducts(products, "units");
  assert.deepEqual(
    byUnits.map((item) => item.slug),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    products.map((item) => item.slug),
    ["a", "b", "c"],
    "sortProducts must not mutate its input",
  );

  const window = readWindow(
    {
      revenue_d30: "123000000",
      cost_d30: "45000000",
      costed_revenue_d30: "120000000",
      orders_d30: "4",
      missing_cost_d30: "1",
    },
    "d30",
  );
  assert.deepEqual(window, {
    revenueMicros: 123_000_000,
    costMicros: 45_000_000,
    costedRevenueMicros: 120_000_000,
    orders: 4,
    missingCostOrders: 1,
  });

  console.log("shop analytics pure tests passed");
}

main();
