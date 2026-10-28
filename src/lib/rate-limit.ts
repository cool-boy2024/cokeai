import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  cokeaiRedis?: Redis;
  cokeaiRedisDisabledUntil?: number;
};

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
  if (!client) return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
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
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
  }
}

export async function acquireConcurrencySlot(
  userId: string,
  limit: number,
): Promise<{ acquired: boolean; key: string }> {
  const key = `cc:user:${userId}`;
  const client = getRedis();
  if (!client) return { acquired: true, key };
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
    return { acquired: true, key };
  }
}

export async function releaseConcurrencySlot(key: string): Promise<void> {
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
