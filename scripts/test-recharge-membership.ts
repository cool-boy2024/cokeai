import {
  CUSTOM_RECHARGE_MAX_MICROS,
  CUSTOM_RECHARGE_MIN_MICROS,
  parseCustomRechargeMicros,
} from "../src/lib/recharge";
import {
  getMembershipInfo,
  memberDiscountLabel,
  memberPriceMicros,
} from "../src/lib/shop/membership";

/**
 * Pure-function checks for custom-amount recharges and member pricing.
 * No database required: `npm run test:recharge-membership`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT: ${message} (expected ${expected}, got ${actual})`);
  }
}

// Custom recharge parsing.
assertEqual(parseCustomRechargeMicros("1"), 1_000_000, "minimum ¥1");
assertEqual(parseCustomRechargeMicros("50"), 50_000_000, "whole yuan");
assertEqual(parseCustomRechargeMicros("50.5"), 50_500_000, "one decimal");
assertEqual(parseCustomRechargeMicros("50.55"), 50_550_000, "two decimals");
assertEqual(parseCustomRechargeMicros(" 50.55 "), 50_550_000, "trims spaces");
assertEqual(parseCustomRechargeMicros("0.99"), null, "below minimum");
assertEqual(parseCustomRechargeMicros("0"), null, "zero");
assertEqual(parseCustomRechargeMicros("10000"), CUSTOM_RECHARGE_MAX_MICROS, "maximum ¥10000");
assertEqual(parseCustomRechargeMicros("10000.01"), null, "above maximum");
assertEqual(parseCustomRechargeMicros("50.555"), null, "three decimals");
assertEqual(parseCustomRechargeMicros("-50"), null, "negative");
assertEqual(parseCustomRechargeMicros("1e3"), null, "scientific notation");
assertEqual(parseCustomRechargeMicros("50,00"), null, "comma");
assertEqual(parseCustomRechargeMicros(""), null, "empty");
assertEqual(parseCustomRechargeMicros("abc"), null, "text");
assertEqual(parseCustomRechargeMicros(".5"), null, "leading dot");
assertEqual(parseCustomRechargeMicros("123456"), null, "more than five integer digits");
assertEqual(CUSTOM_RECHARGE_MIN_MICROS, 1_000_000, "min constant");

// Member pricing: 15% off ¥100 = ¥85.
assertEqual(memberPriceMicros(100_000_000, 0, 1_500), 85_000_000, "15% member price");
assertEqual(memberPriceMicros(100_000_000, 0, 0), 100_000_000, "no discount");
assertEqual(memberPriceMicros(100_000_000, 0, 9_000), 10_000_000, "90% cap");
assertEqual(memberPriceMicros(100_000_000, 0, 20_000), 10_000_000, "over-cap clamps to 90%");
// Floor: never below supplier cost.
assertEqual(memberPriceMicros(100_000_000, 90_000_000, 5_000), 90_000_000, "cost floor");
assertEqual(memberPriceMicros(100_000_000, 120_000_000, 5_000), 100_000_000, "floor never above retail");
assertEqual(memberPriceMicros(0, 0, 1_500), 0, "zero retail passes through");

// Membership state.
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
assertEqual(
  getMembershipInfo({ plan_kind: "membership", plan_expires_at: future, plan_discount_bps: 1_500 })
    .active,
  true,
  "active membership",
);
assertEqual(
  getMembershipInfo({ plan_kind: "membership", plan_expires_at: past, plan_discount_bps: 1_500 })
    .active,
  false,
  "expired membership",
);
assertEqual(
  getMembershipInfo({ plan_kind: "topup", plan_expires_at: future, plan_discount_bps: 1_500 }).active,
  false,
  "topup plan is not membership",
);
assertEqual(getMembershipInfo(null).active, false, "anonymous user");

assertEqual(memberDiscountLabel(1_500), "8.5 折", "85% label");
assertEqual(memberDiscountLabel(2_000), "8 折", "80% label");
assertEqual(memberDiscountLabel(0), "无折扣", "no discount label");

console.log("recharge & membership tests ok");
