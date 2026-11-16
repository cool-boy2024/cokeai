import { ensureConnected, getRedis } from "@/lib/rate-limit";

/**
 * Lightweight attack telemetry and alerting.
 *
 * Everything here is best-effort: Redis may be unavailable and the guard must
 * never take the shop down. Events are capped in a Redis sorted set, so the
 * admin page can show recent activity without a database migration.
 */

export type SecurityEventType =
  | "probe"
  | "rate_limit"
  | "server_action"
  | "auth"
  | "shop"
  | "support"
  | "test";

export type SecurityEvent = {
  at: number;
  type: SecurityEventType;
  ip: string;
  path: string;
  method: string;
  detail?: string;
  ua?: string;
  /** 运营给这个 IP 起的名字，只在后台展示时填充。 */
  label?: string;
  /** 这个 IP 是否为受信管理员出口。 */
  trusted?: boolean;
};

export type SecurityIpCount = {
  ip: string;
  count: number;
  /** 运营给这个 IP 起的名字，例如「办公室」「家里」。只做展示。 */
  label?: string;
  /** 这个 IP 是否为受信管理员出口（白名单）。 */
  trusted?: boolean;
};

export type DefenseMode = "normal" | "emergency";

export type SecurityStatus = "normal" | "scan" | "watch" | "attack" | "emergency";

export type SecurityHourBucket = {
  at: number;
  label: string;
  shortLabel: string;
  count: number;
};

export type SecuritySnapshot = {
  available: boolean;
  generatedAt: number;
  windowMinutes: number;
  windowCount: number;
  threshold: number;
  attack: boolean;
  status: SecurityStatus;
  /** Human-readable reasons the attack rule matched; empty when it did not. */
  attackReasons: string[];
  count5m: number;
  count15m: number;
  count1h: number;
  /** Non-deduped blocks per event type inside the recent windows. */
  count5mByType: Record<string, number>;
  count15mByType: Record<string, number>;
  uniqueIps5m: number;
  uniqueIps15m: number;
  todayTotal: number;
  todayUniqueIps: number;
  last24hTotal: number;
  last7dTotal: number;
  byType: Record<string, number>;
  byTypeLast7d: Record<string, number>;
  hourly: SecurityHourBucket[];
  topIps: SecurityIpCount[];
  recent: SecurityEvent[];
  lastEventAt: number | null;
  lastAttackAt: number | null;
  alertCooldownSeconds: number;
  alertChannelConfigured: boolean;
  strictMode: boolean;
  strictSecondsRemaining: number;
  defenseMode: DefenseMode;
  defenseSince: number | null;
  defenseSecondsRemaining: number;
};

const EVENTS_KEY = "sec:events";
const STRICT_KEY = "sec:strict";
const DEFENSE_KEY = "sec:defense";
const DEFENSE_HOURS = 24;
const MAX_EVENTS = 2_000;
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
const WINDOW_MINUTES = 15;

// Non-deduped counters: one increment per actually blocked request.
const STATS_PREFIX = "sec:stats";
const STATS_TTL_SECONDS = 9 * 24 * 60 * 60;
const MINUTE_COUNTER_TTL_SECONDS = 2 * 60 * 60;
const LAST_EVENT_KEY = `${STATS_PREFIX}:last`;
const ATTACK_MARK_KEY = `${STATS_PREFIX}:attack:last`;
// Per-type and per-source minute buckets. The old whole-minute counter only
// knew the total, which made a single scanner hitting /.env look identical to
// a credential-stuffing wave. These two let the status rule separate them.
const TYPE_MINUTE_PREFIX = `${STATS_PREFIX}:t`;
const IP_MINUTE_PREFIX = `${STATS_PREFIX}:i`;
const PUBLIC_STATUS_CACHE_MS = 60_000;

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const securityPolicy = {
  guardEnabled: (process.env.SECURITY_GUARD_ENABLED || "true").toLowerCase() !== "false",
  alertCooldownMinutes: positiveInt("SECURITY_ALERT_COOLDOWN_MINUTES", 30),
  eventRetentionDays: positiveInt("SECURITY_EVENT_RETENTION_DAYS", 7),
} as const;

export type SecurityWindowCounts = {
  count5m: number;
  count15m: number;
  count1h: number;
  count5mByType?: Record<string, number>;
  count15mByType?: Record<string, number>;
  uniqueIps5m?: number;
  uniqueIps15m?: number;
};

/**
 * Visible status thresholds.
 *
 * Internet-wide scanners probe /.env, /.git and wp-login all day. Those hits
 * are blocked, but a lone scanner working through a list is not an attack on
 * this shop, so it gets the neutral "扫描探测" state and never pages anyone.
 * "攻击中" requires a pattern that implies intent or scale: many sources at
 * once, abuse of the login/order/support/action endpoints, or a sustained
 * flood. The proxy policies themselves are unchanged.
 */
export const securityStatusRules = {
  watch5m: 5,
  watch1h: 10,
  scanProbe15m: 30,
  attackProbe5m: 300,
  attackProbe15m: 600,
  distributed5mIps: 5,
  distributed5mBlocks: 60,
  distributed15mIps: 10,
  distributed15mBlocks: 120,
  attackAbuse15m: 10,
  attackFlood15m: 600,
} as const;

const ABUSE_EVENT_TYPES: SecurityEventType[] = [
  "auth",
  "shop",
  "support",
  "server_action",
];

function typeTotal(
  counts: Record<string, number> | undefined,
  type: SecurityEventType,
): number {
  return counts?.[type] ?? 0;
}

/** Empty array means the activity is below the attack rule. */
export function attackReasons(counts: SecurityWindowCounts): string[] {
  const byType5m = counts.count5mByType;
  const byType15m = counts.count15mByType;
  const uniqueIps5m = counts.uniqueIps5m ?? 0;
  const uniqueIps15m = counts.uniqueIps15m ?? 0;
  const reasons: string[] = [];

  const probe5m = typeTotal(byType5m, "probe");
  const probe15m = typeTotal(byType15m, "probe");
  if (probe5m >= securityStatusRules.attackProbe5m) {
    reasons.push(`扫描探测 5 分钟 ${probe5m} 次`);
  } else if (probe15m >= securityStatusRules.attackProbe15m) {
    reasons.push(`扫描探测 15 分钟 ${probe15m} 次`);
  }

  if (
    uniqueIps5m >= securityStatusRules.distributed5mIps &&
    counts.count5m >= securityStatusRules.distributed5mBlocks
  ) {
    reasons.push(`分布式来源：5 分钟内 ${uniqueIps5m} 个 IP、${counts.count5m} 次拦截`);
  } else if (
    uniqueIps15m >= securityStatusRules.distributed15mIps &&
    counts.count15m >= securityStatusRules.distributed15mBlocks
  ) {
    reasons.push(
      `分布式来源：15 分钟内 ${uniqueIps15m} 个 IP、${counts.count15m} 次拦截`,
    );
  }

  const abuse = ABUSE_EVENT_TYPES.map(
    (type) => [type, typeTotal(byType15m, type)] as const,
  ).filter(([, count]) => count >= securityStatusRules.attackAbuse15m);
  if (abuse.length > 0) {
    reasons.push(
      `敏感入口异常（15 分钟）：${abuse
        .map(([type, count]) => `${SECURITY_EVENT_LABELS[type]} ${count}`)
        .join("、")}`,
    );
  }

  const rateLimited = typeTotal(byType15m, "rate_limit");
  if (rateLimited >= securityStatusRules.attackFlood15m) {
    reasons.push(`限流触发 15 分钟 ${rateLimited} 次`);
  }

  return reasons;
}

export const SECURITY_EVENT_LABELS: Record<SecurityEventType, string> = {
  probe: "扫描探测",
  rate_limit: "触发限流",
  server_action: "Server Action 频控",
  auth: "登录注册异常",
  shop: "下单频控",
  support: "客服接口频控",
  test: "测试事件",
};

export const SECURITY_STATUS_LABELS: Record<SecurityStatus, string> = {
  normal: "正常",
  scan: "扫描探测",
  watch: "观察",
  attack: "攻击中",
  emergency: "应急防护",
};

/**
 * Status is derived from real, non-deduped block counters. Emergency mode wins;
 * then the attack rule; a lone scanner that only hits blocked paths is labelled
 * "扫描探测" (neutral, no alert); lower recent activity is "观察".
 */
export function getSecurityStatus(
  defenseMode: DefenseMode,
  counts: SecurityWindowCounts,
): SecurityStatus {
  if (defenseMode === "emergency") return "emergency";
  if (attackReasons(counts).length > 0) return "attack";

  const probe15m = typeTotal(counts.count15mByType, "probe");
  const nonProbe15m = counts.count15m - probe15m;
  if (
    probe15m >= securityStatusRules.scanProbe15m &&
    nonProbe15m < securityStatusRules.attackAbuse15m
  ) {
    return "scan";
  }

  if (
    counts.count5m >= securityStatusRules.watch5m ||
    counts.count1h >= securityStatusRules.watch1h
  ) {
    return "watch";
  }
  return "normal";
}

const SUSPICIOUS_PATH_PATTERNS = [
  /^\/\.(?:env|git|svn|hg|aws|ssh|ds_store)/i,
  /^\/(?:wp-admin|wp-login|wp-content|xmlrpc|phpmyadmin|pma|adminer|server-status|server-info|actuator|solr|console|manager\/html|vendor\/phpunit)/i,
  /(?:^|\/)(?:\.\.|%2e%2e|%252e)(?:\/|$)/i,
  /\.(?:php|asp|aspx|jsp|cgi)$/i,
];

export function isSuspiciousPath(pathname: string): boolean {
  return SUSPICIOUS_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

// One extra Redis read every 15 seconds per process, not per request.
let strictCache = { value: false, expiresAt: 0 };

export async function isStrictMode(): Promise<boolean> {
  if (Date.now() < strictCache.expiresAt) return strictCache.value;
  const client = getRedis();
  if (!client) return strictCache.value;
  try {
    await ensureConnected(client);
    const value = await client.get(STRICT_KEY);
    strictCache = { value: value === "1", expiresAt: Date.now() + 15_000 };
    return strictCache.value;
  } catch {
    return strictCache.value;
  }
}

export async function setStrictMode(
  enabled: boolean,
  minutes = 60,
): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    await ensureConnected(client);
    if (enabled) {
      await client.set(STRICT_KEY, "1", "EX", Math.max(60, minutes * 60));
    } else {
      await client.del(STRICT_KEY);
    }
    strictCache = { value: enabled, expiresAt: Date.now() + 15_000 };
    return true;
  } catch (error) {
    console.warn(
      "[security] strict mode failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

const ADMIN_IP_KEY_PREFIX = "sec:adminip:";
const ADMIN_IP_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_IP_CACHE_MS = 30_000;

/**
 * Optional permanent allowlist, for an IP the operator controls before any
 * login has happened (office line, VPN egress). Comma-separated exact IPs.
 */
function envAdminIps(): string[] {
  return (process.env.SECURITY_ADMIN_IPS || "")
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

const adminIpCache = new Map<string, { trusted: boolean; expiresAt: number }>();

/* ---------------------------------------------------------------------------
 * IP 备注
 *
 * 只用来在后台把「自己的 IP」和「陌生 IP」区分开，**不参与任何放行判断**。
 * 这是有意的：把一段 IP 加白会让同网段的邻居一起绕过限流（家用宽带 IPv6
 * 常常是动态分配），那等于开了一个洞。备注只是标签。
 * ------------------------------------------------------------------------- */

const IP_LABEL_KEY_PREFIX = "sec:iplabel:";
const IP_LABEL_TTL_SECONDS = 365 * 24 * 60 * 60;

export async function setIpLabel(ip: string, label: string): Promise<boolean> {
  if (!ip || ip === "local") return false;
  const client = getRedis();
  if (!client) return false;
  const clean = label.trim().slice(0, 40);
  try {
    await ensureConnected(client);
    if (!clean) {
      await client.del(`${IP_LABEL_KEY_PREFIX}${ip}`);
      return true;
    }
    await client.set(
      `${IP_LABEL_KEY_PREFIX}${ip}`,
      clean,
      "EX",
      IP_LABEL_TTL_SECONDS,
    );
    return true;
  } catch (error) {
    console.warn(
      "[security] ip label not saved",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export async function getIpLabels(ips: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(ips.filter((ip) => ip && ip !== "local"))];
  if (unique.length === 0) return labels;
  const client = getRedis();
  if (!client) return labels;
  try {
    await ensureConnected(client);
    const values = await client.mget(
      unique.map((ip) => `${IP_LABEL_KEY_PREFIX}${ip}`),
    );
    unique.forEach((ip, index) => {
      const value = values[index];
      if (value) labels.set(ip, value);
    });
  } catch (error) {
    console.warn(
      "[security] ip labels not read",
      error instanceof Error ? error.message : error,
    );
  }
  return labels;
}

/**
 * 给一组 IP 记录补上备注和受信标记。只读展示用，不改任何判定。
 */
async function attachIpMeta<T extends { ip: string }>(items: T[]): Promise<Array<T & { label?: string; trusted?: boolean }>> {
  if (items.length === 0) return items;
  const ips = items.map((item) => item.ip);
  const [labels, trustedFlags] = await Promise.all([
    getIpLabels(ips),
    Promise.all(items.map((item) => isTrustedAdminIp(item.ip).catch(() => false))),
  ]);
  return items.map((item, index) => {
    const label = labels.get(item.ip);
    const trusted = trustedFlags[index];
    return {
      ...item,
      ...(label ? { label } : {}),
      ...(trusted ? { trusted: true } : {}),
    };
  });
}

/**
 * True for an operator IP that must stay reachable while rate limits are on.
 * A successful admin login records its IP for a week; SECURITY_ADMIN_IPS adds
 * IPs ahead of time. The auth layer keeps its own per-IP/per-email caps, so
 * this is an escape hatch for the console, not a brute-force bypass.
 */
export async function isTrustedAdminIp(ip: string): Promise<boolean> {
  if (!ip || ip === "local") return false;
  if (envAdminIps().includes(ip)) return true;

  const cached = adminIpCache.get(ip);
  if (cached && Date.now() < cached.expiresAt) return cached.trusted;

  const client = getRedis();
  if (!client) return false;
  try {
    await ensureConnected(client);
    const trusted = (await client.get(`${ADMIN_IP_KEY_PREFIX}${ip}`)) === "1";
    if (adminIpCache.size > 500) adminIpCache.clear();
    adminIpCache.set(ip, {
      trusted,
      expiresAt: Date.now() + ADMIN_IP_CACHE_MS,
    });
    return trusted;
  } catch {
    return false;
  }
}

const adminIpSavedAt = new Map<string, number>();
const ADMIN_IP_REFRESH_MS = 60 * 60 * 1000;

/** Records the IP of a signed-in admin. Best-effort and throttled to hourly. */
export async function rememberAdminIp(ip: string): Promise<void> {
  if (!ip || ip === "local") return;
  const last = adminIpSavedAt.get(ip);
  if (last && Date.now() - last < ADMIN_IP_REFRESH_MS) return;
  const client = getRedis();
  if (!client) return;
  try {
    await ensureConnected(client);
    await client.set(
      `${ADMIN_IP_KEY_PREFIX}${ip}`,
      "1",
      "EX",
      ADMIN_IP_TTL_SECONDS,
    );
    adminIpSavedAt.set(ip, Date.now());
    adminIpCache.set(ip, { trusted: true, expiresAt: Date.now() + ADMIN_IP_CACHE_MS });
  } catch (error) {
    console.warn(
      "[security] admin ip not remembered",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Message shown to customers while temporary protection is tightening limits.
 * It deliberately does not mention counters, blocked paths or defense knobs;
 * the operator console keeps those details.
 */
export const PUBLIC_ATTACK_NOTICE =
  "网站正在遭受攻击，部分访问可能短暂受限。我们正在处理，请稍后刷新重试；已提交的订单、付款和工单都会保留。";

/** Non-null only while strict/emergency protection is active. */
export async function getPublicSecurityNotice(): Promise<string | null> {
  return (await isStrictMode()) ? PUBLIC_ATTACK_NOTICE : null;
}

/**
 * Emergency defense is the admin-facing "one button" switch for a real attack.
 *
 * It tightens application limits immediately and marks the deployment as being
 * in emergency mode so every operator sees the same state. It deliberately
 * does NOT touch Cloudflare Tunnel or rebuild containers: those are production
 * changes that need a human on the server and a rollback window.
 */
export async function activateEmergencyDefense(
  hours = DEFENSE_HOURS,
): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  const ttlHours = Math.max(1, Math.round(hours));
  try {
    await ensureConnected(client);
    // Strict mode is what actually halves the limits in proxy.ts.
    if (!(await setStrictMode(true, ttlHours * 60))) return false;
    await client.set(
      DEFENSE_KEY,
      JSON.stringify({ mode: "emergency", since: Date.now() }),
      "EX",
      ttlHours * 60 * 60,
    );
    return true;
  } catch (error) {
    console.warn(
      "[security] emergency defense failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export async function deactivateEmergencyDefense(): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    await ensureConnected(client);
    await client.del(DEFENSE_KEY);
    await setStrictMode(false);
    return true;
  } catch (error) {
    console.warn(
      "[security] emergency defense rollback failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function clientIpFromHeaders(headers: Headers): string {
  const cloudflare = headers.get("cf-connecting-ip");
  if (cloudflare?.trim()) return cloudflare.trim().slice(0, 64);
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return (headers.get("x-real-ip") || "local").trim().slice(0, 64);
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  hourCycle: "h23",
});

const timelineShortFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});

function dayKey(at = Date.now()): string {
  return dayFormatter.format(new Date(at));
}

function hourKey(at: number): string {
  return hourFormatter.format(new Date(at));
}

function hourField(at: number): string {
  return `h${hourKey(at)}`;
}

function minuteCounterKey(at: number): string {
  return `${STATS_PREFIX}:m:${Math.floor(at / 60_000)}`;
}

function recentDayKeys(now: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => dayKey(now - index * 86_400_000));
}

function minuteCounterKeys(now: number, count: number): string[] {
  const currentMinute = Math.floor(now / 60_000);
  return Array.from(
    { length: count },
    (_, index) => `${STATS_PREFIX}:m:${currentMinute - index}`,
  );
}

function typeMinuteKeys(now: number, count: number): string[] {
  const currentMinute = Math.floor(now / 60_000);
  return Array.from(
    { length: count },
    (_, index) => `${TYPE_MINUTE_PREFIX}:${currentMinute - index}`,
  );
}

function ipMinuteKeys(now: number, count: number): string[] {
  const currentMinute = Math.floor(now / 60_000);
  return Array.from(
    { length: count },
    (_, index) => `${IP_MINUTE_PREFIX}:${currentMinute - index}`,
  );
}

function timelineShortLabel(at: number): string {
  const hour = hourKey(at);
  if (hour === "00") return timelineShortFormatter.format(new Date(at));
  return `${Number(hour)}时`;
}

function timelineLabel(at: number): string {
  return `${timelineShortFormatter.format(new Date(at))} ${hourKey(at)}:00`;
}

function sumNumbers(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value || 0), 0);
}

function typeCountsFromHash(hash: Record<string, string> | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!hash) return counts;
  for (const [field, raw] of Object.entries(hash)) {
    if (field === "total" || /^h\d{2}$/.test(field)) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) counts[field] = value;
  }
  return counts;
}

function addTypeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [type, count] of Object.entries(source)) {
    target[type] = (target[type] || 0) + count;
  }
}

function numericValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeEvent(
  input: Omit<SecurityEvent, "at"> & { at?: number },
): SecurityEvent {
  const type =
    input.type && input.type in SECURITY_EVENT_LABELS
      ? input.type
      : ("probe" as SecurityEventType);
  return {
    at: input.at ?? Date.now(),
    type,
    ip: clip(input.ip, 64) || "unknown",
    path: clip(input.path, 300) || "/",
    method: clip(input.method, 12) || "GET",
    detail: clip(input.detail, 200),
    ua: clip(input.ua, 200),
  };
}

/**
 * Increment the non-deduped block counters. This is called for every blocked
 * request before the 60-second event dedupe, so "today / 24h / 7d" never
 * undercounts a burst that the event log intentionally collapses.
 *
 * Keys:
 * - sec:stats:YYYY-MM-DD     hash: total, one field per type, h00..h23
 * - sec:stats:m:<epochMin>   per-minute total for 5m / 15m / 1h windows
 * - sec:stats:t:<epochMin>   per-minute hash, one field per event type
 * - sec:stats:i:<epochMin>   per-minute HyperLogLog of source IPs
 * - sec:stats:last           last block timestamp
 * - sec:stats:attack:last    last time the attack rule matched
 * - sec:ips / sec:ipcount    unique IPs and per-IP counts for the day
 *
 * Every key has a TTL of at least two hours; daily keys live nine days so the
 * admin page can show today plus the previous seven days.
 */
export async function bumpSecurityCounters(
  type: SecurityEventType,
  at = Date.now(),
  ip = "unknown",
): Promise<void> {
  const client = getRedis();
  if (!client) return;

  const day = dayKey(at);
  const statsKey = `${STATS_PREFIX}:${day}`;
  const minute = Math.floor(at / 60_000);
  const minuteKey = `${STATS_PREFIX}:m:${minute}`;
  const typeMinuteKey = `${TYPE_MINUTE_PREFIX}:${minute}`;
  const ipMinuteKey = `${IP_MINUTE_PREFIX}:${minute}`;
  try {
    await ensureConnected(client);
    await client
      .multi()
      .hincrby(statsKey, "total", 1)
      .hincrby(statsKey, type, 1)
      .hincrby(statsKey, hourField(at), 1)
      .expire(statsKey, STATS_TTL_SECONDS)
      .incr(minuteKey)
      .expire(minuteKey, MINUTE_COUNTER_TTL_SECONDS)
      .hincrby(typeMinuteKey, type, 1)
      .expire(typeMinuteKey, MINUTE_COUNTER_TTL_SECONDS)
      .pfadd(ipMinuteKey, ip)
      .expire(ipMinuteKey, MINUTE_COUNTER_TTL_SECONDS)
      .set(LAST_EVENT_KEY, String(at), "EX", STATS_TTL_SECONDS)
      // Per-source counts are also non-deduped, so the admin top-IP table
      // matches the total instead of showing one event per 60s window.
      .pfadd(`sec:ips:${day}`, ip)
      .expire(`sec:ips:${day}`, COUNTER_TTL_SECONDS)
      .zincrby(`sec:ipcount:${day}`, 1, ip)
      .zremrangebyrank(`sec:ipcount:${day}`, 0, -5_001)
      .expire(`sec:ipcount:${day}`, COUNTER_TTL_SECONDS)
      .exec();
  } catch (error) {
    console.warn(
      "[security] counters not recorded",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Persist one event. Called only when a guard actually blocks something, so
 * the common path costs no extra Redis writes.
 */
export async function recordSecurityEvent(
  input: Omit<SecurityEvent, "at"> & { at?: number },
): Promise<void> {
  const event = normalizeEvent(input);
  const client = getRedis();
  if (!client) return;

  try {
    await ensureConnected(client);
    await client
      .multi()
      .zadd(EVENTS_KEY, event.at, JSON.stringify(event))
      .zremrangebyrank(EVENTS_KEY, 0, -(MAX_EVENTS + 1))
      .expire(EVENTS_KEY, securityPolicy.eventRetentionDays * 24 * 60 * 60)
      .exec();
  } catch (error) {
    console.warn(
      "[security] event not recorded",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Collapses a noisy source (one IP hammering many paths) into at most one
 * event per window. The first path is kept as context.
 */
export async function recordSecurityEventOnce(
  input: Omit<SecurityEvent, "at"> & { at?: number },
  dedupeSeconds = 60,
): Promise<void> {
  const event = normalizeEvent(input);

  // Count every block first. The event log below still dedupes noisy sources.
  await bumpSecurityCounters(event.type, event.at, event.ip);

  const client = getRedis();
  if (!client) return;
  const dedupeKey = `sec:dedupe:${event.type}:${event.ip}`;
  try {
    await ensureConnected(client);
    const first = await client.set(
      dedupeKey,
      "1",
      "EX",
      Math.max(5, dedupeSeconds),
      "NX",
    );
    if (first === "OK") await recordSecurityEvent(event);
  } catch (error) {
    console.warn(
      "[security] dedupe failed",
      error instanceof Error ? error.message : error,
    );
  }
}

function parseEvents(raw: unknown): SecurityEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: SecurityEvent[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    try {
      const parsed = JSON.parse(item) as Partial<SecurityEvent>;
      if (!parsed || typeof parsed.at !== "number") continue;
      events.push(normalizeEvent(parsed as SecurityEvent));
    } catch {
      // Ignore malformed entries rather than failing the admin view.
    }
  }
  return events;
}

function commandResult(results: unknown, index: number): unknown {
  if (!Array.isArray(results)) return null;
  const entry = results[index];
  if (!Array.isArray(entry)) return null;
  return entry[1];
}

export async function getSecuritySnapshot(
  recentLimit = 100,
): Promise<SecuritySnapshot> {
  const now = Date.now();
  const day = dayKey(now);
  const since = now - 24 * 60 * 60 * 1000;
  // Loaded lazily so proxying every request never pulls in nodemailer.
  const alertChannelConfigured = await import("@/lib/alerts")
    .then((module) => module.isAlertConfigured())
    .catch(() => false);
  const base: SecuritySnapshot = {
    available: false,
    generatedAt: now,
    windowMinutes: WINDOW_MINUTES,
    windowCount: 0,
    threshold: securityStatusRules.attackProbe15m,
    attack: false,
    status: "normal",
    attackReasons: [],
    count5m: 0,
    count15m: 0,
    count1h: 0,
    count5mByType: {},
    count15mByType: {},
    uniqueIps5m: 0,
    uniqueIps15m: 0,
    todayTotal: 0,
    todayUniqueIps: 0,
    last24hTotal: 0,
    last7dTotal: 0,
    byType: {},
    byTypeLast7d: {},
    hourly: [],
    topIps: [],
    recent: [],
    lastEventAt: null,
    lastAttackAt: null,
    alertCooldownSeconds: 0,
    alertChannelConfigured,
    strictMode: false,
    strictSecondsRemaining: 0,
    defenseMode: "normal",
    defenseSince: null,
    defenseSecondsRemaining: 0,
  };

  const client = getRedis();
  if (!client) return base;

  try {
    await ensureConnected(client);
    const dayKeys = recentDayKeys(now, 7);
    const minuteKeys = minuteCounterKeys(now, 60);
    const recentTypeKeys = typeMinuteKeys(now, 15);
    const recentIpKeys = ipMinuteKeys(now, 15);
    const commands = client.multi();
    commands.mget(...minuteKeys);
    for (const key of dayKeys) commands.hgetall(`${STATS_PREFIX}:${key}`);
    commands.pfcount(`sec:ips:${day}`);
    commands.zrevrange(`sec:ipcount:${day}`, 0, 9, "WITHSCORES");
    commands.zrevrangebyscore(
      EVENTS_KEY,
      "+inf",
      since,
      "LIMIT",
      0,
      Math.min(Math.max(recentLimit, 1), 500),
    );
    commands.ttl("sec:alert:cooldown");
    commands.ttl(STRICT_KEY);
    commands.get(DEFENSE_KEY);
    commands.ttl(DEFENSE_KEY);
    commands.get(ATTACK_MARK_KEY);
    commands.get(LAST_EVENT_KEY);
    // Indexes 17..31: per-type counts for the last 15 minutes, newest first.
    for (const key of recentTypeKeys) commands.hgetall(key);
    // Index 32/33: distinct sources in the last 5 / 15 minutes.
    commands.pfcount(...recentIpKeys.slice(0, 5));
    commands.pfcount(...recentIpKeys);
    const results = await commands.exec();

    // Index 0: last 60 per-minute counters (current minute first).
    const minuteRaw = commandResult(results, 0);
    const minuteCounts = Array.isArray(minuteRaw)
      ? minuteRaw.map((value) => Number(value) || 0)
      : [];
    const count5m = sumNumbers(minuteCounts.slice(0, 5));
    const count15m = sumNumbers(minuteCounts.slice(0, 15));
    const count1h = sumNumbers(minuteCounts.slice(0, 60));

    // Indexes 17..31: per-type counts, current minute first.
    const count5mByType: Record<string, number> = {};
    const count15mByType: Record<string, number> = {};
    for (let index = 0; index < recentTypeKeys.length; index += 1) {
      const raw = commandResult(results, 17 + index);
      const hash =
        raw && typeof raw === "object" ? (raw as Record<string, string>) : null;
      const counts = typeCountsFromHash(hash);
      addTypeCounts(count15mByType, counts);
      if (index < 5) addTypeCounts(count5mByType, counts);
    }
    const uniqueIps5m = Number(commandResult(results, 32) || 0);
    const uniqueIps15m = Number(commandResult(results, 33) || 0);

    // Indexes 1..7: today plus the previous six days.
    const dayHashes = dayKeys.map((_, index) => {
      const raw = commandResult(results, 1 + index);
      return raw && typeof raw === "object"
        ? (raw as Record<string, string>)
        : null;
    });
    const todayHash = dayHashes[0];
    const todayTotal = numericValue(todayHash?.total) ?? 0;
    const byType = typeCountsFromHash(todayHash);
    const byTypeLast7d: Record<string, number> = {};
    let last7dTotal = 0;
    for (const hash of dayHashes) {
      last7dTotal += numericValue(hash?.total) ?? 0;
      addTypeCounts(byTypeLast7d, typeCountsFromHash(hash));
    }

    const hashByDay = new Map(
      dayKeys.map((key, index) => [key, dayHashes[index]] as const),
    );
    const currentHourStart = Math.floor(now / 3_600_000) * 3_600_000;
    const hourly: SecurityHourBucket[] = [];
    for (let offset = 23; offset >= 0; offset -= 1) {
      const at = currentHourStart - offset * 3_600_000;
      const hash = hashByDay.get(dayKey(at));
      const count = numericValue(hash?.[hourField(at)]) ?? 0;
      hourly.push({
        at,
        label: timelineLabel(at),
        shortLabel: timelineShortLabel(at),
        count,
      });
    }
    const last24hTotal = hourly.reduce((total, bucket) => total + bucket.count, 0);

    const todayUniqueIps = Number(commandResult(results, 8) || 0);
    const ipFlat = Array.isArray(commandResult(results, 9))
      ? (commandResult(results, 9) as string[])
      : [];
    const recent = parseEvents(commandResult(results, 10));
    const cooldown = Number(commandResult(results, 11) || 0);
    const strictTtl = Number(commandResult(results, 12) || 0);
    const defenseRaw = commandResult(results, 13);
    const defenseTtl = Number(commandResult(results, 14) || 0);
    const lastAttackRaw = commandResult(results, 15);
    const lastEventRaw = commandResult(results, 16);

    let defenseSince: number | null = null;
    let defenseMode: DefenseMode = "normal";
    if (typeof defenseRaw === "string" && defenseRaw) {
      try {
        const parsed = JSON.parse(defenseRaw) as {
          mode?: string;
          since?: number;
        };
        if (parsed.mode === "emergency") {
          defenseMode = "emergency";
          defenseSince =
            typeof parsed.since === "number" ? parsed.since : null;
        }
      } catch {
        // Older builds stored "1"; fall through to the TTL check below.
      }
    }
    if (defenseMode === "normal" && Number.isFinite(defenseTtl) && defenseTtl > 0) {
      defenseMode = "emergency";
    }

    const topIps: SecurityIpCount[] = [];
    for (let index = 0; index + 1 < ipFlat.length; index += 2) {
      const ip = ipFlat[index];
      const count = Number(ipFlat[index + 1]);
      if (ip && Number.isFinite(count)) topIps.push({ ip, count });
    }

    const windowCounts = {
      count5m,
      count15m,
      count1h,
      count5mByType,
      count15mByType,
      uniqueIps5m,
      uniqueIps15m,
    } satisfies SecurityWindowCounts;
    const status = getSecurityStatus(defenseMode, windowCounts);
    const reasons = attackReasons(windowCounts);
    const attack = reasons.length > 0;

    // Remember the last time the attack rule (not just any block) matched, so
    // the admin page can show it without treating scanner noise as an attack.
    if (attack && now - (numericValue(lastAttackRaw) ?? 0) > 60_000) {
      await client
        .set(ATTACK_MARK_KEY, String(now), "EX", STATS_TTL_SECONDS)
        .catch(() => undefined);
    }

    return {
      ...base,
      available: true,
      windowCount: count15m,
      attack,
      status,
      attackReasons: reasons,
      count5m,
      count15m,
      count1h,
      count5mByType,
      count15mByType,
      uniqueIps5m,
      uniqueIps15m,
      todayTotal,
      todayUniqueIps,
      last24hTotal,
      last7dTotal,
      byType,
      byTypeLast7d,
      hourly,
      // 给榜单和最近事件里的 IP 补上运营起的名字，方便一眼认出「这是自己」。
      topIps: await attachIpMeta(topIps),
      recent: await attachIpMeta(recent),
      lastEventAt: numericValue(lastEventRaw) ?? recent[0]?.at ?? null,
      lastAttackAt: numericValue(lastAttackRaw),
      alertCooldownSeconds: Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 0,
      strictMode: Number.isFinite(strictTtl) && strictTtl > 0,
      strictSecondsRemaining:
        Number.isFinite(strictTtl) && strictTtl > 0 ? strictTtl : 0,
      defenseMode,
      defenseSince,
      defenseSecondsRemaining:
        defenseMode === "emergency" && Number.isFinite(defenseTtl) && defenseTtl > 0
          ? defenseTtl
          : 0,
    };
  } catch (error) {
    console.warn(
      "[security] snapshot failed",
      error instanceof Error ? error.message : error,
    );
    return base;
  }
}

export type PublicSecurityStatus = {
  available: boolean;
  guardEnabled: boolean;
  todayTotal: number | null;
};

let publicStatusCache:
  | { expiresAt: number; value: PublicSecurityStatus }
  | null = null;
let publicStatusInflight: Promise<PublicSecurityStatus> | null = null;

/**
 * Public footer data. Only the daily total is exposed; IPs, paths, alert
 * configuration and recent events stay behind /admin/security.
 *
 * The Redis read is cached in-process for 60 seconds, and any failure degrades
 * to "防护已开启" without a number rather than showing a fake count.
 */
export async function getPublicSecurityStatus(): Promise<PublicSecurityStatus> {
  const now = Date.now();
  if (publicStatusCache && publicStatusCache.expiresAt > now) {
    return publicStatusCache.value;
  }
  if (publicStatusInflight) return publicStatusInflight;

  publicStatusInflight = (async (): Promise<PublicSecurityStatus> => {
    const guardEnabled = securityPolicy.guardEnabled;
    const client = getRedis();
    if (!client) return { available: false, guardEnabled, todayTotal: null };
    try {
      await ensureConnected(client);
      const raw = await client.hget(`${STATS_PREFIX}:${dayKey()}`, "total");
      return {
        available: true,
        guardEnabled,
        todayTotal: numericValue(raw) ?? 0,
      };
    } catch {
      return { available: false, guardEnabled, todayTotal: null };
    }
  })();

  try {
    const value = await publicStatusInflight;
    publicStatusCache = { expiresAt: Date.now() + PUBLIC_STATUS_CACHE_MS, value };
    return value;
  } finally {
    publicStatusInflight = null;
  }
}

/**
 * Returns true at most once per cooldown window while an attack is ongoing.
 * The caller (n8n) is responsible for actually delivering the webhook, so a
 * busy app never blocks on an external notification endpoint.
 */
export async function issueAttackAlertIfDue(
  snapshot: SecuritySnapshot,
): Promise<boolean> {
  if (!snapshot.attack) return false;
  const client = getRedis();
  if (!client) return false;
  try {
    await ensureConnected(client);
    const acquired = await client.set(
      "sec:alert:cooldown",
      "1",
      "EX",
      securityPolicy.alertCooldownMinutes * 60,
      "NX",
    );
    return acquired === "OK";
  } catch {
    return false;
  }
}

/**
 * Delivery failed (webhook down, SMTP rejected). Release the cooldown so the
 * next n8n poll can retry instead of silently skipping the whole window.
 */
export async function releaseAttackAlertCooldown(): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await ensureConnected(client);
    await client.del("sec:alert:cooldown");
  } catch {
    // Best effort; the next window will retry anyway.
  }
}

export function securityRecommendations(snapshot: SecuritySnapshot): string[] {
  const top = Object.entries(snapshot.byType).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  if (!snapshot.attack) {
    if (snapshot.status === "scan") {
      return [
        `当前是 ${snapshot.uniqueIps15m} 个来源的扫描探测（15 分钟 ${snapshot.count15m} 次），全部已拦截，属于互联网背景噪声，不会告警，也无需操作。`,
        "保持告警通道可用（/admin/security/alerts），每周看一次最近事件即可。",
        "重防护（边缘限流、CrowdSec、Anubis）默认关闭，不要提前开在正常业务上。",
      ];
    }
    return [
      "当前未达到攻击判定。保持告警通道可用（/admin/security/alerts），每周看一次最近事件即可。",
      "收到告警后先在 /admin/security 判断类型和来源 IP，再按 docs/SECURITY.md 处置。",
      "重防护（边缘限流、CrowdSec、Anubis）默认关闭，不要提前开在正常业务上。",
    ];
  }

  const advice: string[] = [];
  if (top === "probe") {
    advice.push(
      "扫描探测：到 Cloudflare Security Events 核对来源，封持续扫描的 IP 或 ASN；确认 /.env、/.git 等路径没有真实文件泄露。",
    );
  } else if (top === "auth") {
    advice.push(
      "疑似撞库或暴力登录：立即在后台“临时收紧限流”；检查失败登录的来源与账号；必要时通知受影响用户改密。不要直接封整段云厂商 IP。",
    );
  } else if (top === "shop") {
    advice.push(
      "疑似恶意下单或库存探测：后台“临时收紧限流”，必要时暂停相关商品或新订单；没有真实支付的订单不要发货。",
    );
  } else if (top === "server_action") {
    advice.push(
      "疑似自动化调用后台动作：临时收紧限流，检查是否有账号被盗用；必要时先停用可疑账号。",
    );
  } else if (top === "support") {
    advice.push(
      "自动客服接口被刷：临时关闭客服入口或继续收紧限流，同时确认上游 Key 的费用没有异常增长。",
    );
  } else {
    advice.push(
      "先看 /admin/security 的路径分布：集中在一个接口就收紧该入口，分散在全站则优先在 Cloudflare 层处理。",
    );
  }

  advice.push(
    snapshot.defenseMode === "emergency"
      ? `应急防护已启动，应用层限速减半，约 ${Math.ceil(snapshot.defenseSecondsRemaining / 3600)} 小时后自动恢复；边缘切换仍需运维执行。`
      : snapshot.strictMode
        ? `临时收紧限流已开启，约 ${Math.ceil(snapshot.strictSecondsRemaining / 60)} 分钟后自动恢复；确认攻击停止后可手动恢复。`
        : "登录 /admin/security，点“启动应急防护”：应用层限速立即减半，同时通知运维执行边缘切换，24 小时后自动恢复。",
  );
  advice.push(
    "若站点已超时或出现 5xx：先在 Cloudflare 封来源并考虑 Under Attack Mode；不要急着重启全部容器或清空 Redis。",
  );
  advice.push(
    "处置后记录时间线、来源 IP 和采取的动作；攻击停止前不要关闭告警，也不要删除拦截记录。",
  );
  return advice;
}

export function formatSecurityAlert(snapshot: SecuritySnapshot): string {
  const types = Object.entries(snapshot.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => `${SECURITY_EVENT_LABELS[type as SecurityEventType] || type} ${count}`)
    .join("、");
  const ips = snapshot.topIps
    .slice(0, 5)
    .map((item) => `${item.ip}（${item.count} 次）`)
    .join("、");
  const latest = snapshot.recent[0];
  const advice = securityRecommendations(snapshot)
    .slice(0, 3)
    .map((line, index) => `${index + 1}. ${line}`);

  return [
    snapshot.attack
      ? "CokeAI 安全告警：疑似正在被攻击"
      : `CokeAI 安全摘要：当前状态「${SECURITY_STATUS_LABELS[snapshot.status]}」`,
    snapshot.attack
      ? `判定依据：${snapshot.attackReasons.join("；")}`
      : `近 ${snapshot.windowMinutes} 分钟拦截 ${snapshot.windowCount} 次，未触发攻击判定`,
    `近 ${snapshot.windowMinutes} 分钟拦截：${snapshot.windowCount} 次，来源 ${snapshot.uniqueIps15m} 个 IP`,
    `今日拦截：${snapshot.todayTotal} 次，独立 IP：${snapshot.todayUniqueIps}`,
    `类型：${types || "—"}`,
    `Top IP：${ips || "—"}`,
    `最近：${latest ? `${latest.method} ${latest.path}（${latest.type}）` : "—"}`,
    `应急防护：${
      snapshot.defenseMode === "emergency"
        ? `已启动，剩余约 ${Math.ceil(snapshot.defenseSecondsRemaining / 3600)} 小时`
        : "未启动"
    }`,
    "处置建议：",
    ...advice,
    `后台：/admin/security`,
    `时间：${new Date(snapshot.generatedAt).toISOString()}`,
  ].join("\n");
}

async function postAlertWebhook(
  text: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: string }> {
  const { sendAlert } = await import("@/lib/alerts");
  return sendAlert(text, extra);
}

/**
 * Tells the operator channel that a human flipped the emergency switch.
 * Includes the exact staged edge steps so whoever is on call does not have to
 * remember the runbook under pressure. No secrets are included.
 */
export async function sendEmergencyDefenseNotice(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const text = enabled
    ? [
        "CokeAI 应急防护已启动（管理员手动）",
        "已生效：应用层敏感路径限速减半，24 小时后自动恢复。",
        "待运维执行（按顺序确认）：",
        "1. 构建带 caddy-ratelimit 的边缘镜像：docker build --build-arg GOPROXY=https://goproxy.cn,direct -f ops/edge/Dockerfile -t cokeai-caddy:ratelimit .",
        "2. 挂载限流片段并重建 edge：EDGE_LIMITS_FILE=./ops/edge/limits.rate-limit.caddy docker compose -f docker-compose.yml -f ops/edge/compose.build.yml up -d edge",
        "3. 验证通过并经审批后，把 Cloudflare Tunnel origin 从 app:3000 改为 edge:8080，复验首页 /shop /login /v1。",
        "后台：/admin/security（可关闭应急防护）",
        `时间：${new Date().toISOString()}`,
      ].join("\n")
    : [
        "CokeAI 应急防护已关闭（管理员手动）",
        "已恢复：应用层限流回到常规水平。",
        "请确认 Cloudflare Tunnel origin 已改回 app:3000，并复验首页、/shop、/login、/v1。",
        "后台：/admin/security",
        `时间：${new Date().toISOString()}`,
      ].join("\n");
  return postAlertWebhook(text, {
    source: "cokeai-security",
    emergency_defense: enabled ? "on" : "off",
  });
}

async function claimManualAlert(key: string, seconds: number): Promise<boolean> {
  const client = getRedis();
  if (!client) return true;
  try {
    await ensureConnected(client);
    return (await client.set(key, "1", "EX", seconds, "NX")) === "OK";
  } catch {
    // Redis down: a human explicitly asked to send, do not block the action.
    return true;
  }
}

export async function sendSecurityTestAlert(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!(await claimManualAlert("sec:alert:test", 30))) {
    return { ok: false, error: "测试过于频繁，请 30 秒后再试" };
  }
  const text = [
    "CokeAI 安全告警通道测试",
    "这是一条管理员手动触发的测试消息。",
    `时间：${new Date().toISOString()}`,
  ].join("\n");
  return postAlertWebhook(text, { test: true });
}

/**
 * Manual escape hatch: n8n may be down while the site is under attack, so the
 * admin can push the current summary directly from /admin/security.
 */
export async function sendSecuritySummaryAlert(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!(await claimManualAlert("sec:alert:manual", 30))) {
    return { ok: false, error: "请 30 秒后再发送" };
  }
  const snapshot = await getSecuritySnapshot(50);
  const text = `${formatSecurityAlert(snapshot)}\n\n（管理员手动发送）`;
  return postAlertWebhook(text, { attack: snapshot.attack, manual: true });
}
