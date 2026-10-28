function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.toLowerCase() !== "false";
}

export const config = {
  appName: "CokeAI",
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  fxCnyMicros: Math.round(floatEnv("USD_CNY_RATE", 7.2) * 1_000_000),
  commissionBps: intEnv("REFERRAL_COMMISSION_BPS", 1000),
  commissionHoldDays: intEnv("REFERRAL_HOLD_DAYS", 7),
  apiRequestsPerMinute: intEnv("API_REQUESTS_PER_MINUTE", 60),
  apiConcurrency: intEnv("API_CONCURRENCY_PER_USER", 4),
  maxActiveApiKeys: intEnv("MAX_ACTIVE_API_KEYS", 8),
  upstreamTimeoutMs: intEnv("UPSTREAM_TIMEOUT_MS", 180_000),
  defaultMaxOutputTokens: intEnv("DEFAULT_MAX_OUTPUT_TOKENS", 2048),
  hardMaxOutputTokens: intEnv("HARD_MAX_OUTPUT_TOKENS", 16_384),
  sessionDays: intEnv("SESSION_DAYS", 14),
  stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
  manualPaymentsEnabled:
    (process.env.MANUAL_PAYMENTS_ENABLED || "true").toLowerCase() !== "false",

  // ---- Sub2API gateway -----------------------------------------------------
  sub2apiUrl: (process.env.SUB2API_INTERNAL_URL || "http://127.0.0.1:18080").replace(/\/$/, ""),
  sub2apiAdminEmail: process.env.SUB2API_ADMIN_EMAIL || "",
  sub2apiAdminPassword: process.env.SUB2API_ADMIN_PASSWORD || "",
  sub2apiGroupId: intEnv("SUB2API_GROUP_ID", 0),
  sub2apiTimeoutMs: intEnv("SUB2API_TIMEOUT_MS", 8_000),
  sub2apiUserConcurrency: intEnv("SUB2API_USER_CONCURRENCY", 4),
  sub2apiUserRpm: intEnv("SUB2API_USER_RPM", 60),
  lowBalanceCny: floatEnv("LOW_BALANCE_CNY", 10),

  // ---- Live pricing --------------------------------------------------------
  pricingMarkupBps: intEnv("PRICING_MARKUP_BPS", 12_000),
  pricingOfficialDiscountBps: intEnv("PRICING_OFFICIAL_DISCOUNT_BPS", 1_000),
  pricingMinMarginBps: intEnv("PRICING_MIN_MARGIN_BPS", 1_500),
  pricingMaxIncreaseBps: intEnv("PRICING_MAX_INCREASE_BPS", 3_000),
  pricingSyncIntervalMinutes: intEnv("PRICING_SYNC_INTERVAL_MINUTES", 60),
  publicPriceUrl:
    process.env.PUBLIC_PRICE_URL ||
    "https://raw.githubusercontent.com/Wei-Shaw/model-price-repo/main/model_prices_and_context_window.json",
  fxApiUrl: process.env.FX_API_URL || "https://open.er-api.com/v6/latest/USD",

  // ---- Payments ------------------------------------------------------------
  easypayEnabled: boolEnv("EASYPAY_ENABLED", false),
  easypayGateway: (process.env.EASYPAY_GATEWAY || "").replace(/\/$/, ""),
  easypayPid: process.env.EASYPAY_PID || "",
  easypayKey: process.env.EASYPAY_KEY || "",
  easypaySignType: (process.env.EASYPAY_SIGN_TYPE || "MD5").toUpperCase(),
  easypayAlipayType: process.env.EASYPAY_ALIPAY_TYPE || "alipay",
  // Optional risk caps for the shop's EasyPay channel. 0 disables a cap.
  easypayShopMaxOrderCny: floatEnv("EASYPAY_SHOP_MAX_ORDER_CNY", 0),
  easypayShopDailyMaxCny: floatEnv("EASYPAY_SHOP_DAILY_MAX_CNY", 0),

  usdtEnabled: boolEnv("USDT_ENABLED", false),
  usdtNetwork: "trc20" as const,
  usdtXpub: process.env.USDT_TRC20_XPUB || "",
  usdtContract: process.env.USDT_TRC20_CONTRACT || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  usdtTronGridUrl: (process.env.USDT_TRONGRID_URL || "https://api.trongrid.io").replace(/\/$/, ""),
  usdtTronGridApiKey: process.env.USDT_TRONGRID_API_KEY || "",
  usdtRateUrl:
    process.env.USDT_RATE_URL ||
    "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny",
  usdtConfirmations: intEnv("USDT_CONFIRMATIONS", 19),
  usdtQuoteMinutes: intEnv("USDT_QUOTE_MINUTES", 30),
  usdtMinAmount: floatEnv("USDT_MIN_AMOUNT", 1),
  usdtCnyRate: floatEnv("USDT_CNY_RATE", 7.25),
  usdtCnyRateBufferBps: intEnv("USDT_CNY_RATE_BUFFER_BPS", 100),
  usdtUnderpayToleranceBps: intEnv("USDT_UNDERPAY_TOLERANCE_BPS", 50),
  usdtAmountToleranceUsdt: floatEnv("USDT_AMOUNT_TOLERANCE", 0.01),
  usdtLateGraceHours: intEnv("USDT_LATE_GRACE_HOURS", 24),

  // ---- Shop (digital goods) ------------------------------------------------
  shopEnabled: boolEnv("SHOP_ENABLED", true),
  // EasyPay stays dormant for the shop until the operator explicitly enables
  // it; it can be configured for credit recharge without showing in the shop.
  shopEasypayEnabled: boolEnv("SHOP_EASYPAY_ENABLED", false),
  shopFeedUrl:
    process.env.SHOP_FEED_URL || "https://aibijia.org/live-data/products.json",
  shopFeedMetaUrl:
    process.env.SHOP_FEED_META_URL || "https://aibijia.org/live-data/meta.json",
  shopSyncIntervalMinutes: intEnv("SHOP_SYNC_INTERVAL_MINUTES", 60),
  shopMinMarginBps: intEnv("SHOP_MIN_MARGIN_BPS", 1_500),
  shopMaxCostIncreaseBps: intEnv("SHOP_MAX_COST_INCREASE_BPS", 2_500),
  shopMissingRunsLimit: intEnv("SHOP_MISSING_RUNS_LIMIT", 3),
  shopOrderExpireMinutes: intEnv("SHOP_ORDER_EXPIRE_MINUTES", 30),
  shopUsdtGraceHours: intEnv("SHOP_USDT_GRACE_HOURS", 24),
  shopMaxQty: intEnv("SHOP_MAX_QTY", 1),
  shopMaxOpenOrders: intEnv("SHOP_MAX_OPEN_ORDERS", 3),
  shopCustomerInputRetentionDays: intEnv("SHOP_CUSTOMER_INPUT_RETENTION_DAYS", 7),
  shopSupportEmail:
    process.env.SHOP_SUPPORT_EMAIL ||
    process.env.SUPPORT_EMAIL ||
    "support@cokeai.cc.cd",
} as const;

export function isPlanActive(expiresAt: Date | string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}
