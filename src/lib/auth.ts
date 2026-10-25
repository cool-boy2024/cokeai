import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { config, isPlanActive } from "./config";
import { query, toNumber } from "./db";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "cokeai_session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  balance_micros: number;
  plan_id: string | null;
  plan_name: string | null;
  plan_tier: number | null;
  plan_expires_at: string | null;
  plan_active: boolean;
  referral_code: string;
  referred_by: string | null;
  created_at: string;
};

type UserDbRow = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  balance_micros: string | number;
  plan_id: string | null;
  plan_name: string | null;
  plan_tier: string | number | null;
  plan_expires_at: string | null;
  referral_code: string;
  referred_by: string | null;
  created_at: string;
};

function mapUser(row: UserDbRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    balance_micros: toNumber(row.balance_micros),
    plan_id: row.plan_id,
    plan_name: row.plan_name,
    plan_tier: row.plan_tier === null ? null : toNumber(row.plan_tier),
    plan_expires_at: row.plan_expires_at,
    plan_active: isPlanActive(row.plan_expires_at),
    referral_code: row.referral_code,
    referred_by: row.referred_by,
    created_at: row.created_at,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const maxAge = config.sessionDays * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  await query("DELETE FROM sessions WHERE expires_at <= now()");
  await query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash, userId, expiresAt],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = await query<UserDbRow>(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.balance_micros,
            u.plan_id, p.name AS plan_name, p.tier AS plan_tier,
            u.plan_expires_at, u.referral_code, u.referred_by, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN plans p ON p.id = u.plan_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.status = 'active'
      LIMIT 1`,
    [sha256(token)],
  );

  const row = result.rows[0];
  return row ? mapUser(row) : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export async function getClientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headerStore.get("cf-connecting-ip") || headerStore.get("x-real-ip") || "local";
}

export type ApiKeyUser = {
  apiKeyId: string;
  userId: string;
  email: string;
  name: string;
  balanceMicros: number;
  planId: string | null;
  planTier: number;
  planExpiresAt: string | null;
  planActive: boolean;
};

export async function authenticateApiKey(
  authorization: string | null,
): Promise<{ user?: ApiKeyUser; error?: string; status?: number }> {
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return { error: "缺少 API Key。请使用 Authorization: Bearer sk-coke-...", status: 401 };
  }
  const plain = authorization.slice(7).trim();
  if (!plain.startsWith("sk-coke-")) {
    return { error: "API Key 格式无效。", status: 401 };
  }

  const result = await query<{
    api_key_id: string;
    user_id: string;
    email: string;
    name: string;
    balance_micros: string;
    plan_id: string | null;
    plan_tier: string | number | null;
    plan_expires_at: string | null;
    status: string;
  }>(
    `SELECT k.id AS api_key_id, u.id AS user_id, u.email, u.name, u.balance_micros,
            u.plan_id, p.tier AS plan_tier, u.plan_expires_at, u.status
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       LEFT JOIN plans p ON p.id = u.plan_id
      WHERE k.key_hash = $1
        AND k.revoked_at IS NULL
      LIMIT 1`,
    [sha256(plain)],
  );

  const row = result.rows[0];
  if (!row) return { error: "API Key 无效或已撤销。", status: 401 };
  if (row.status !== "active") return { error: "账户已被停用。", status: 403 };

  const planActive = isPlanActive(row.plan_expires_at);
  if (!planActive) {
    return { error: "套餐已到期，请在控制台续费后继续使用。", status: 403 };
  }

  await query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.api_key_id]);

  return {
    user: {
      apiKeyId: row.api_key_id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      balanceMicros: toNumber(row.balance_micros),
      planId: row.plan_id,
      planTier: row.plan_tier === null ? 0 : toNumber(row.plan_tier),
      planExpiresAt: row.plan_expires_at,
      planActive,
    },
  };
}
