/**
 * Custom-amount recharges.
 *
 * Every recharge order still points at a plan row because orders.plan_id is a
 * non-null foreign key. "custom" is a hidden placeholder plan; the real amount
 * comes from the form and is validated here on the server.
 */

export const CUSTOM_RECHARGE_PLAN_ID = "custom";
export const CUSTOM_RECHARGE_MIN_MICROS = 1_000_000; // ¥1.00
export const CUSTOM_RECHARGE_MAX_MICROS = 10_000_000_000; // ¥10,000.00

const AMOUNT_PATTERN = /^\d{1,5}(?:\.\d{1,2})?$/;

/**
 * Parse a yuan string into micros. Returns null for anything that is not a
 * plain amount with at most two decimals inside the allowed range, so callers
 * can show one stable error instead of guessing.
 */
export function parseCustomRechargeMicros(raw: string): number | null {
  const value = raw.trim();
  if (!AMOUNT_PATTERN.test(value)) return null;
  const [yuanPart, centPart = ""] = value.split(".");
  const yuan = Number(yuanPart);
  const cents = Number(centPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(yuan) || !Number.isSafeInteger(cents)) return null;
  const micros = yuan * 1_000_000 + cents * 10_000;
  if (!Number.isSafeInteger(micros)) return null;
  if (micros < CUSTOM_RECHARGE_MIN_MICROS || micros > CUSTOM_RECHARGE_MAX_MICROS) {
    return null;
  }
  return micros;
}

export function customRechargeError(): string {
  return `请输入 ¥${CUSTOM_RECHARGE_MIN_MICROS / 1_000_000}–¥${CUSTOM_RECHARGE_MAX_MICROS / 1_000_000} 之间的金额，最多两位小数。`;
}
