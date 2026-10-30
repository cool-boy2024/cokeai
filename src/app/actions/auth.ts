"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getClientIp,
  hashPassword,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { query } from "@/lib/db";
import { generateReferralCode } from "@/lib/crypto";
import { fixedWindowLimit } from "@/lib/rate-limit";
import { recordSecurityEventOnce } from "@/lib/security";
import {
  ensureGatewayIdentity,
  getGatewayIdentity,
} from "@/lib/sub2api/identity";

export type AuthState = { error?: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("请输入有效邮箱"),
  password: z.string().min(1, "请输入密码"),
  next: z.string().optional(),
});

const registerSchema = z.object({
  name: z.string().trim().min(2, "昵称至少 2 个字符").max(40, "昵称过长"),
  email: z.string().trim().toLowerCase().email("请输入有效邮箱"),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码不能超过 72 位"),
  ref: z.string().trim().max(32).optional(),
});

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

async function authRateLimit(action: string, email: string): Promise<string | null> {
  const ip = await getClientIp();
  const ipCap = action === "register" ? 10 : 20;
  const emailCap = action === "register" ? 5 : 10;
  const ipLimit = await fixedWindowLimit(`rl:auth:${action}:ip:${ip}`, ipCap, 600);
  if (!ipLimit.allowed) {
    await recordSecurityEventOnce(
      {
        type: "auth",
        ip,
        path: `/${action}`,
        method: "POST",
        detail: `${action} ip limit ${ipCap}/10m`,
      },
      60,
    );
    return "尝试次数过多，请 10 分钟后再试。";
  }
  const emailLimit = await fixedWindowLimit(
    `rl:auth:${action}:email:${email}`,
    emailCap,
    600,
  );
  if (!emailLimit.allowed) return "该邮箱尝试次数过多，请稍后再试。";
  return null;
}

/**
 * A single wrong password is normal. A burst from one IP, or a global burst
 * across many IPs, looks like credential stuffing and should reach the admin.
 */
async function noteAuthFailure(action: string): Promise<void> {
  const ip = await getClientIp();
  const [ipFailures, globalFailures] = await Promise.all([
    fixedWindowLimit(`rl:auth:fail:ip:${ip}`, 8, 600),
    fixedWindowLimit("rl:auth:fail:all", 60, 600),
  ]);
  if (ipFailures.allowed && globalFailures.allowed) return;
  await recordSecurityEventOnce(
    {
      type: "auth",
      ip,
      path: `/${action}`,
      method: "POST",
      detail: `${action} failures ip=${ipFailures.allowed ? "below" : "over"} global=${
        globalFailures.allowed ? "below" : "over"
      }`,
    },
    600,
  );
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "登录信息不完整" };
  }

  const limitError = await authRateLimit("login", parsed.data.email);
  if (limitError) return { error: limitError };

  const result = await query<{
    id: string;
    password_hash: string;
    status: string;
  }>("SELECT id, password_hash, status FROM users WHERE email = $1 LIMIT 1", [
    parsed.data.email,
  ]);

  const user = result.rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    await noteAuthFailure("login");
    return { error: "邮箱或密码不正确" };
  }
  if (user.status !== "active") {
    return { error: "该账户已被停用，请联系管理员" };
  }

  // Best-effort gateway provisioning retry. A gateway outage must not block login.
  try {
    const identity = await getGatewayIdentity(user.id);
    if (!identity || identity.state !== "active" || !identity.sub2api_user_id) {
      await ensureGatewayIdentity(user.id);
    }
  } catch (error) {
    console.warn("[gateway] provisioning retry failed", error instanceof Error ? error.message : error);
  }

  await createSession(user.id);
  redirect(safeNext(parsed.data.next));
}

export async function registerAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    ref: formData.get("ref") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "注册信息不完整" };
  }

  const limitError = await authRateLimit("register", parsed.data.email);
  if (limitError) return { error: limitError };

  let referrerId: string | null = null;
  if (parsed.data.ref) {
    const referrer = await query<{ id: string }>(
      "SELECT id FROM users WHERE referral_code = $1 LIMIT 1",
      [parsed.data.ref.toUpperCase()],
    );
    if (!referrer.rows[0]) return { error: "邀请码不存在" };
    referrerId = referrer.rows[0].id;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const referralCode = generateReferralCode(parsed.data.name);

  try {
    const inserted = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [parsed.data.email, passwordHash, parsed.data.name, referralCode, referrerId],
    );

    // Best-effort: create the Sub2API mirror user. Login retries this if it fails.
    try {
      await ensureGatewayIdentity(inserted.rows[0].id);
    } catch (error) {
      console.warn(
        "[gateway] provisioning failed during register",
        error instanceof Error ? error.message : error,
      );
    }

    await createSession(inserted.rows[0].id);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return { error: "该邮箱已注册，请直接登录" };
    }
    console.error("[register]", error);
    return { error: "注册失败，请稍后重试" };
  }

  redirect("/dashboard/billing?welcome=1");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

export type PasswordState = { error?: string; success?: string };

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(8, "新密码至少 8 位").max(72, "密码不能超过 72 位"),
});

export async function updatePasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "密码信息不完整" };
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return { error: "新密码不能与当前密码相同" };
  }

  const result = await query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [user.id],
  );
  if (!result.rows[0]) return { error: "账户不存在" };
  if (!(await verifyPassword(parsed.data.currentPassword, result.rows[0].password_hash))) {
    return { error: "当前密码不正确" };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await query(
    "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1",
    [user.id, newHash],
  );
  await query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  await createSession(user.id);

  return { success: "密码已更新，其他设备上的登录会话已失效。" };
}
