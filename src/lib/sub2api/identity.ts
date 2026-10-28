import { config } from "@/lib/config";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { query } from "@/lib/db";
import { adminRequest } from "./auth";
import {
  hasSub2ApiId,
  isSub2ApiConfigured,
  sub2ApiPathId,
  Sub2ApiError,
  type Sub2ApiId,
  type Sub2ApiPaginated,
  type Sub2ApiUser,
} from "./client";

export type GatewayIdentity = {
  user_id: string;
  sub2api_user_id: Sub2ApiId | null;
  sub2api_email: string;
  password_encrypted: string;
  state: "pending" | "active" | "failed";
  last_error: string | null;
  provisioned_at: string | null;
};

type LocalUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
};

function requireConfig(): void {
  if (!isSub2ApiConfigured()) {
    throw new Sub2ApiError("网关尚未配置，请联系管理员", 0);
  }
}

export async function getGatewayIdentity(userId: string): Promise<GatewayIdentity | null> {
  const result = await query<GatewayIdentity>(
    `SELECT user_id, sub2api_user_id, sub2api_email, password_encrypted,
            state, last_error, provisioned_at
       FROM gateway_identities
      WHERE user_id = $1
      LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function findSub2ApiUserByEmail(email: string): Promise<Sub2ApiUser | null> {
  const data = await adminRequest<Sub2ApiPaginated<Sub2ApiUser>>(
    `/api/v1/admin/users?search=${encodeURIComponent(email)}&page=1&page_size=20`,
  );
  const target = email.trim().toLowerCase();
  return (
    (data.items || []).find((item) => item.email?.trim().toLowerCase() === target) || null
  );
}

function gatewayEmailFor(local: LocalUser): string {
  const email = local.email.trim().toLowerCase();
  const adminEmail = config.sub2apiAdminEmail.trim().toLowerCase();
  if (email !== adminEmail) return email;

  // The storefront admin email is also the Sub2API administrator login. Never
  // adopt/reset that account; give the admin's gateway mirror a deterministic
  // separate address instead.
  const domain = adminEmail.includes("@") ? adminEmail.split("@")[1] : "cokeai.local";
  return `gateway-${local.id}@${domain}`;
}

async function createOrAdoptUser(
  local: LocalUser,
  gatewayEmail: string,
  password: string,
): Promise<Sub2ApiUser> {
  try {
    return await adminRequest<Sub2ApiUser>("/api/v1/admin/users", {
      method: "POST",
      body: {
        email: gatewayEmail,
        password,
        username: local.name,
        notes: `cokeai:${local.id}`,
        role: "user",
        balance: 0,
        concurrency: config.sub2apiUserConcurrency,
        rpm_limit: config.sub2apiUserRpm,
        allowed_groups: [config.sub2apiGroupId],
        restrict_public_groups: true,
      },
    });
  } catch (error) {
    if (!(error instanceof Sub2ApiError)) throw error;

    // A previous attempt may have created the remote user before a crash.
    // Reconcile by email, then make sure the stored gateway password works.
    const existing = await findSub2ApiUserByEmail(gatewayEmail);
    if (!existing) throw error;

    // Never adopt a Sub2API administrator account by email. The cheapest
    // failure mode here is refusing the registration, not resetting the
    // gateway admin password to a value controlled by the shop app.
    if (existing.role === "admin") {
      throw new Sub2ApiError("该邮箱已被网关管理员占用，请更换邮箱", 409);
    }

    return adminRequest<Sub2ApiUser>(`/api/v1/admin/users/${sub2ApiPathId(existing.id)}`, {
      method: "PUT",
      body: {
        password,
        username: local.name,
        notes: `cokeai:${local.id}`,
        concurrency: config.sub2apiUserConcurrency,
        rpm_limit: config.sub2apiUserRpm,
        allowed_groups: [config.sub2apiGroupId],
        restrict_public_groups: true,
      },
    });
  }
}

/**
 * Creates the Sub2API mirror user if needed. Safe to call repeatedly.
 */
export async function ensureGatewayIdentity(userId: string): Promise<GatewayIdentity> {
  requireConfig();

  const localResult = await query<LocalUser>(
    "SELECT id, email, name, role, status FROM users WHERE id = $1 LIMIT 1",
    [userId],
  );
  const local = localResult.rows[0];
  if (!local) throw new Sub2ApiError("用户不存在", 0);

  let identity = await getGatewayIdentity(userId);
  if (!identity) {
    const password = randomToken(32);
    const inserted = await query<GatewayIdentity>(
      `INSERT INTO gateway_identities
        (user_id, sub2api_email, password_encrypted, state)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
       RETURNING user_id, sub2api_user_id, sub2api_email, password_encrypted,
                 state, last_error, provisioned_at`,
      [userId, local.email, encryptSecret(password)],
    );
    identity = inserted.rows[0];
  }

  if (identity.state === "active" && hasSub2ApiId(identity.sub2api_user_id)) {
    return identity;
  }

  const password = randomToken(32);
  const encrypted = encryptSecret(password);

  try {
    const gatewayEmail = gatewayEmailFor(local);
    const remote = await createOrAdoptUser(local, gatewayEmail, password);
    const remoteId = sub2ApiPathId(remote.id);
    const updated = await query<GatewayIdentity>(
      `UPDATE gateway_identities
          SET sub2api_user_id = $2,
              sub2api_email = $3,
              password_encrypted = $4,
              state = 'active',
              last_error = NULL,
              provisioned_at = now(),
              updated_at = now()
        WHERE user_id = $1
        RETURNING user_id, sub2api_user_id, sub2api_email, password_encrypted,
                  state, last_error, provisioned_at`,
      [userId, remoteId, gatewayEmail, encrypted],
    );
    return updated.rows[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : "网关用户创建失败";
    await query(
      `UPDATE gateway_identities
          SET state = 'failed', last_error = $2, updated_at = now()
        WHERE user_id = $1`,
      [userId, message.slice(0, 500)],
    );
    throw error instanceof Sub2ApiError
      ? error
      : new Sub2ApiError("网关用户创建失败", 0);
  }
}

export async function ensureGatewayIdentityReady(userId: string): Promise<GatewayIdentity> {
  const identity = await getGatewayIdentity(userId);
  if (identity?.state === "active" && hasSub2ApiId(identity.sub2api_user_id)) return identity;
  return ensureGatewayIdentity(userId);
}

export async function setRemoteUserStatus(
  userId: string,
  status: "active" | "disabled",
): Promise<void> {
  const identity = await getGatewayIdentity(userId);
  if (!hasSub2ApiId(identity?.sub2api_user_id)) {
    if (status === "disabled") return;
    await ensureGatewayIdentity(userId);
    return;
  }
  await adminRequest(`/api/v1/admin/users/${sub2ApiPathId(identity.sub2api_user_id)}`, {
    method: "PUT",
    body: { status },
  });
}
