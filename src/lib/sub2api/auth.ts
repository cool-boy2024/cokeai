import { config } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { ensureConnected, getRedis } from "@/lib/rate-limit";
import {
  sub2apiRequest,
  Sub2ApiError,
  type Sub2ApiLoginData,
  type Sub2ApiProfile,
} from "./client";

type CachedToken = { token: string; expiresAt: number };
const memory = new Map<string, CachedToken>();

function cacheKey(kind: "admin" | "user", id: string): string {
  return `cokeai:sub2api:jwt:${kind}:${id}`;
}

function ttlSeconds(data: Sub2ApiLoginData): number {
  const expires = Number(data.expires_in || 0);
  if (expires > 600) return Math.min(expires - 300, 12 * 60 * 60);
  return 12 * 60 * 60;
}

async function readCached(key: string): Promise<string | null> {
  const local = memory.get(key);
  if (local && local.expiresAt > Date.now()) return local.token;

  const client = getRedis();
  if (client) {
    try {
      await ensureConnected(client);
      const raw = await client.get(key);
      if (raw) {
        const token = decryptSecret(raw);
        memory.set(key, { token, expiresAt: Date.now() + 60_000 });
        return token;
      }
    } catch {
      // Cache is best-effort.
    }
  }
  return null;
}

async function writeCached(key: string, token: string, ttl: number): Promise<void> {
  memory.set(key, { token, expiresAt: Date.now() + ttl * 1000 });
  const client = getRedis();
  if (!client) return;
  try {
    await ensureConnected(client);
    await client.set(key, encryptSecret(token), "EX", ttl);
  } catch {
    // Cache is best-effort.
  }
}

export async function invalidateToken(kind: "admin" | "user", id: string): Promise<void> {
  const key = cacheKey(kind, id);
  memory.delete(key);
  const client = getRedis();
  if (!client) return;
  try {
    await ensureConnected(client);
    await client.del(key);
  } catch {
    // Ignore.
  }
}

async function login(email: string, password: string): Promise<Sub2ApiLoginData> {
  if (!email || !password) {
    throw new Sub2ApiError("网关账号未配置", 0);
  }
  return sub2apiRequest<Sub2ApiLoginData>("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    timeoutMs: config.sub2apiTimeoutMs,
  });
}

export async function getAdminToken(force = false): Promise<string> {
  const key = cacheKey("admin", config.sub2apiAdminEmail || "default");
  if (!force) {
    const cached = await readCached(key);
    if (cached) return cached;
  }
  const data = await login(config.sub2apiAdminEmail, config.sub2apiAdminPassword);
  await writeCached(key, data.access_token, ttlSeconds(data));
  return data.access_token;
}

export async function getUserToken(
  userId: string,
  email: string,
  passwordEncrypted: string,
  force = false,
): Promise<string> {
  const key = cacheKey("user", userId);
  if (!force) {
    const cached = await readCached(key);
    if (cached) return cached;
  }
  const password = decryptSecret(passwordEncrypted);
  const data = await login(email, password);
  await writeCached(key, data.access_token, ttlSeconds(data));
  return data.access_token;
}

export async function adminRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  try {
    return await sub2apiRequest<T>(path, {
      ...options,
      token: await getAdminToken(),
    });
  } catch (error) {
    if (!(error instanceof Sub2ApiError)) throw error;
    // A legal acknowledgement is a stable account state, not an expired token.
    // Re-login would just repeat the same 403, so surface it to the admin.
    if (error.requiresLegalAcknowledgement) throw error;
    if (![401, 403].includes(error.status)) throw error;

    await invalidateToken("admin", config.sub2apiAdminEmail || "default");
    try {
      return await sub2apiRequest<T>(path, {
        ...options,
        token: await getAdminToken(true),
      });
    } catch (retryError) {
      if (retryError instanceof Sub2ApiError && retryError.requiresLegalAcknowledgement) {
        throw retryError;
      }
      throw retryError;
    }
  }
}

export async function userRequest<T>(
  userId: string,
  email: string,
  passwordEncrypted: string,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  try {
    return await sub2apiRequest<T>(path, {
      ...options,
      token: await getUserToken(userId, email, passwordEncrypted),
    });
  } catch (error) {
    if (!(error instanceof Sub2ApiError) || ![401, 403].includes(error.status)) throw error;
    await invalidateToken("user", userId);
    return sub2apiRequest<T>(path, {
      ...options,
      token: await getUserToken(userId, email, passwordEncrypted, true),
    });
  }
}

export async function getGatewayProfile(
  userId: string,
  email: string,
  passwordEncrypted: string,
): Promise<Sub2ApiProfile> {
  return userRequest<Sub2ApiProfile>(userId, email, passwordEncrypted, "/api/v1/user/profile");
}
