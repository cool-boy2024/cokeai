import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

/**
 * Generic EasyPay (彩虹易支付 / ZPay-compatible) adapter.
 *
 * Different providers ship slightly different signing rules. This adapter
 * supports the two common layouts:
 *   - sorted: sort all non-empty params by key, join key=value&, append key
 *   - concat: pid + type + out_trade_no + notify_url + return_url + name + money + sitename + key
 *
 * Set EASYPAY_SIGN_MODE=concat when the provider documents the fixed
 * concatenation order. Default is sorted.
 */
type SignMode = "sorted" | "concat";

export const EASYPAY_KEY_MISSING_MESSAGE =
  "支付宝支付未配置完整：缺少 EASYPAY_KEY，无法签名或校验回调。";

function signMode(): SignMode {
  return (process.env.EASYPAY_SIGN_MODE || "sorted").toLowerCase() === "concat"
    ? "concat"
    : "sorted";
}

function md5(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function signString(
  params: Record<string, string>,
  key: string,
  mode: SignMode = signMode(),
): string {
  if (mode === "concat") {
    const order = [
      "pid",
      "type",
      "out_trade_no",
      "notify_url",
      "return_url",
      "name",
      "money",
      "sitename",
    ];
    return order.map((name) => params[name] || "").join("") + key;
  }
  const entries = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([name, value]) => `${name}=${value}`).join("&") + key;
}

export function easyPayConfigError(): string | null {
  if (!config.easypayEnabled) return "支付宝支付尚未启用。";
  if (!config.easypayGateway || !config.easypayPid) {
    return "支付宝支付未配置完整：缺少 EASYPAY_GATEWAY 或 EASYPAY_PID。";
  }
  if (!config.easypayKey) return EASYPAY_KEY_MISSING_MESSAGE;
  if (config.easypaySignType !== "MD5") {
    return `暂不支持的支付宝签名类型：${config.easypaySignType}（仅支持 MD5）。`;
  }
  return null;
}

export function isEasyPayConfigured(): boolean {
  return easyPayConfigError() === null;
}

export type EasyPayOrderInput = {
  orderId: string;
  amountYuan: number;
  productName: string;
  /** Override for the shop; defaults to the credit-recharge webhook. */
  notifyUrl?: string;
  /** Override for the shop; defaults to the billing return page. */
  returnUrl?: string;
};

export function buildEasyPayCheckout(input: EasyPayOrderInput): {
  url: string;
  params: Record<string, string>;
} {
  const configError = easyPayConfigError();
  if (configError) throw new Error(configError);

  const params: Record<string, string> = {
    pid: config.easypayPid,
    type: config.easypayAlipayType,
    out_trade_no: input.orderId,
    notify_url: input.notifyUrl || `${config.appUrl}/api/webhooks/easypay`,
    return_url:
      input.returnUrl ||
      `${config.appUrl}/dashboard/billing?provider=alipay&order=${encodeURIComponent(input.orderId)}`,
    name: input.productName.slice(0, 60),
    money: input.amountYuan.toFixed(2),
    sitename: config.appName,
    sign_type: config.easypaySignType,
  };
  params.sign = md5(signString(params, config.easypayKey));

  const configuredSubmit = (process.env.EASYPAY_SUBMIT_URL || "").trim();
  const gatewaySubmit = /\/submit\.php$/i.test(config.easypayGateway)
    ? config.easypayGateway
    : `${config.easypayGateway}/submit.php`;
  const submitBase = configuredSubmit || gatewaySubmit;
  const query = new URLSearchParams(params).toString();
  return { url: `${submitBase}${submitBase.includes("?") ? "&" : "?"}${query}`, params };
}

export type EasyPayNotification = {
  valid: boolean;
  orderId: string;
  tradeNo: string;
  amount: number;
  status: string;
  raw: Record<string, string>;
  error?: string;
};

/**
 * Verifies an EasyPay notification. The comparand is an MD5 hex digest, so
 * both sides are reduced to lowercase and compared in constant time.
 */
export function verifyEasyPaySignature(
  raw: Record<string, string>,
  key: string,
  mode: SignMode = signMode(),
): boolean {
  if (!key) return false;
  const provided = (raw.sign || "").trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(provided)) return false;

  const expected = md5(signString(raw, key, mode));
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseEasyPayNotification(
  payload: Record<string, string | string[] | undefined>,
): EasyPayNotification {
  const raw: Record<string, string> = {};
  for (const [name, value] of Object.entries(payload)) {
    raw[name] = Array.isArray(value) ? value[0] || "" : value || "";
  }

  const orderId = raw.out_trade_no || "";
  const tradeNo = raw.trade_no || "";
  const amount = Number.parseFloat(raw.money || "0");
  const status = raw.trade_status || "";

  if (!config.easypayKey) {
    return {
      valid: false,
      orderId,
      tradeNo,
      amount: Number.isFinite(amount) ? amount : 0,
      status,
      raw,
      error: EASYPAY_KEY_MISSING_MESSAGE,
    };
  }

  if (!orderId || !tradeNo || !Number.isFinite(amount) || amount <= 0) {
    return {
      valid: false,
      orderId,
      tradeNo,
      amount: Number.isFinite(amount) ? amount : 0,
      status,
      raw,
      error: "回调参数不完整",
    };
  }

  const valid = verifyEasyPaySignature(raw, config.easypayKey);
  return {
    valid,
    orderId,
    tradeNo,
    amount,
    status,
    raw,
    error: valid ? undefined : "签名校验失败",
  };
}
