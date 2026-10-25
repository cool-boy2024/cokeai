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
} as const;

export function isPlanActive(expiresAt: Date | string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}
