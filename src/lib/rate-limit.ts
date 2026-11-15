import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  cokeaiRedis?: Redis;
  cokeaiRedisDisabledUntil?: number;
  cokeaiMemoryLimits?: Map<string, { count: number; resetAt: number }>;
};

const MEMORY_LIMIT_MAX_KEYS = 10_000;

function memoryLimits(): Map<string, { count: number; resetAt: number }> {
  if (!globalForRedis.cokeaiMemoryLimits) {
    globalForRedis.cokeaiMemoryLimits = new Map();
  }
  const store = globalForRedis.cokeaiMemoryLimits;
  const now = Date.now();
  if (store.size > MEMORY_LIMIT_MAX_KEYS) {
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
    if (store.size > MEMORY_LIMIT_MAX_KEYS) store.clear();
  }
  return store;
}

/**
 * Per-process fallback used when Redis is unavailable. Rate limits and captcha
 * replay protection must not disappear entirely during a Redis outage; a single
 * app container can enforce the same window locally until Redis returns.
 */
function memoryIncrement(key: string, windowSeconds: number): { count: number; resetIn: number } {
  const store = memoryLimits();
  const now = Date.now();
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const entry = { count: 1, resetAt: now + windowSeconds * 1_000 };
    store.set(key, entry);
    return { count: 1, resetIn: windowSeconds };
  }
  existing.count += 1;
  return {
    count: existing.count,
    resetIn: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
  };
}

function memoryDecrement(key: string): void {
  const store = memoryLimits();
  const existing = store.get(key);
  if (!existing) return;
  if (existing.resetAt <= Date.now() || existing.count <= 1) {
    store.delete(key);
    return;
  }
  existing.count -= 1;
}

const RELEASE_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
if current <= 1 then
  redis.call("DEL", KEYS[1])
  return 0
end
return redis.call("DECR", KEYS[1])
`;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if ((globalForRedis.cokeaiRedisDisabledUntil || 0) > Date.now()) return null;
  if (!globalForRedis.cokeaiRedis) {
    const client = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
    client.on("error", (error) => {
      console.warn("[redis]", error.message);
      globalForRedis.cokeaiRedisDisabledUntil = Date.now() + 30_000;
    });
    globalForRedis.cokeaiRedis = client;
  }
  return globalForRedis.cokeaiRedis;
}

export async function ensureConnected(client: Redis): Promise<void> {
  if (client.status === "wait") await client.connect();
}

export type LimitResult = { allowed: boolean; remaining: number; resetSeconds: number };

export async function fixedWindowLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const client = getRedis();
  if (!client) {
    const local = memoryIncrement(key, windowSeconds);
    return {
      allowed: local.count <= limit,
      remaining: Math.max(0, limit - local.count),
      resetSeconds: local.resetIn,
    };
  }
  try {
    await ensureConnected(client);
    const result = await client.multi().incr(key).expire(key, windowSeconds, "NX").exec();
    const count = Number(result?.[0]?.[1] || 1);
    const ttl = await client.ttl(key);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: Math.max(1, ttl),
    };
  } catch (error) {
    console.warn("[rate-limit]", error instanceof Error ? error.message : error);
    globalForRedis.cokeaiRedisDisabledUntil = Date.now() + 30_000;
    const local = memoryIncrement(key, windowSeconds);
    return {
      allowed: local.count <= limit,
      remaining: Math.max(0, limit - local.count),
      resetSeconds: local.resetIn,
    };
  }
}

/**
 * Counts distinct values seen inside a rolling window.
 *
 * Used by the shop crawl guard: each product slug is a sorted-set member, so
 * repeated visits to the same product do not inflate the count. Fails open
 * (returns 0) when Redis is unavailable — the fixed-window policy still caps
 * total requests, and the guard must never take browsing down.
 */
export async function rollingDistinctCount(
  key: string,
  value: string,
  windowSeconds: number,
): Promise<number> {
  const client = getRedis();
  if (!client) return 0;
  try {
    await ensureConnected(client);
    const now = Date.now();
    await client
      .multi()
      .zremrangebyscore(key, 0, now - windowSeconds * 1_000)
      .zadd(key, now, value)
      .expire(key, windowSeconds * 2)
      .exec();
    return await client.zcard(key);
  } catch (error) {
    console.warn("[crawl-guard]", error instanceof Error ? error.message : error);
    globalForRedis.cokeaiRedisDisabledUntil = Date.now() + 30_000;
    return 0;
  }
}

export async function acquireConcurrencySlot(
  userId: string,
  limit: number,
): Promise<{ acquired: boolean; key: string }> {
  const key = `cc:user:${userId}`;
  const client = getRedis();
  if (!client) {
    const local = memoryIncrement(key, 300);
    if (local.count > limit) memoryDecrement(key);
    return { acquired: local.count <= limit, key };
  }
  try {
    await ensureConnected(client);
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, 300);
    if (count > limit) {
      await client.eval(RELEASE_SCRIPT, 1, key);
      return { acquired: false, key };
    }
    return { acquired: true, key };
  } catch (error) {
    console.warn("[concurrency]", error instanceof Error ? error.message : error);
    globalForRedis.cokeaiRedisDisabledUntil = Date.now() + 30_000;
    const local = memoryIncrement(key, 300);
    if (local.count > limit) memoryDecrement(key);
    return { acquired: local.count <= limit, key };
  }
}

export async function releaseConcurrencySlot(key: string): Promise<void> {
  memoryDecrement(key);
  const client = getRedis();
  if (!client) return;
  try {
    await ensureConnected(client);
    await client.eval(RELEASE_SCRIPT, 1, key);
  } catch (error) {
    console.warn("[concurrency-release]", error instanceof Error ? error.message : error);
  }
}

export async function redisHealth(): Promise<"ok" | "unavailable"> {
  const client = getRedis();
  if (!client) return "unavailable";
  try {
    await ensureConnected(client);
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}
