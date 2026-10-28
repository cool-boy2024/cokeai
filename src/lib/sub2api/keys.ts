import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { generateApiKey, sha256 } from "@/lib/crypto";
import { query, toNumber } from "@/lib/db";
import { userRequest } from "./auth";
import {
  hasSub2ApiId,
  isSub2ApiConfigured,
  sub2ApiPathId,
  Sub2ApiError,
  type Sub2ApiApiKey,
  type Sub2ApiId,
} from "./client";
import {
  ensureGatewayIdentityReady,
  getGatewayIdentity,
  type GatewayIdentity,
} from "./identity";

export class KeyActionError extends Error {
  userMessage: string;

  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "KeyActionError";
    this.userMessage = userMessage;
    if (cause !== undefined) this.cause = cause;
  }
}

type KeyRow = {
  id: string;
  user_id: string;
  sub2api_key_id: Sub2ApiId | null;
  sync_state: string;
  revoked_at: string | null;
};

function looksLikeFullKey(value: string | undefined | null): value is string {
  return Boolean(
    value &&
      value.length >= 16 &&
      !value.includes("…") &&
      !value.includes("...") &&
      !value.includes("*"),
  );
}

export async function createRemoteKey(
  userId: string,
  name: string,
  key: string,
): Promise<{ identity: GatewayIdentity; remote: Sub2ApiApiKey }> {
  const identity = await ensureGatewayIdentityReady(userId);
  if (!hasSub2ApiId(identity.sub2api_user_id)) throw new Error("网关用户未就绪");

  const remote = await userRequest<Sub2ApiApiKey>(
    identity.user_id,
    identity.sub2api_email,
    identity.password_encrypted,
    "/api/v1/keys",
    {
      method: "POST",
      body: {
        name,
        custom_key: key,
        group_id: config.sub2apiGroupId || undefined,
      },
    },
  );
  sub2ApiPathId(remote.id);
  return { identity, remote };
}

export async function deleteRemoteKey(
  userId: string,
  identity: GatewayIdentity,
  sub2apiKeyId: Sub2ApiId,
): Promise<void> {
  await userRequest(
    userId,
    identity.sub2api_email,
    identity.password_encrypted,
    `/api/v1/keys/${sub2ApiPathId(sub2apiKeyId)}`,
    { method: "DELETE" },
  );
}

export async function listRemoteKeys(
  userId: string,
  identity: GatewayIdentity,
): Promise<Sub2ApiApiKey[]> {
  const data = await userRequest<
    { items?: Sub2ApiApiKey[]; data?: Sub2ApiApiKey[] } | Sub2ApiApiKey[]
  >(
    userId,
    identity.sub2api_email,
    identity.password_encrypted,
    "/api/v1/keys?page=1&page_size=100",
  );
  if (Array.isArray(data)) return data;
  return data.items || data.data || [];
}

async function findRemoteKeyByPlaintext(
  userId: string,
  plaintext: string,
): Promise<{ identity: GatewayIdentity; remote: Sub2ApiApiKey } | null> {
  try {
    const identity = await ensureGatewayIdentityReady(userId);
    const remoteKeys = await listRemoteKeys(userId, identity);
    const targetHash = sha256(plaintext);
    const remote = remoteKeys.find(
      (item) =>
        item.key === plaintext ||
        (looksLikeFullKey(item.key) && sha256(item.key) === targetHash),
    );
    return remote ? { identity, remote } : null;
  } catch {
    return null;
  }
}

async function markRevoked(userId: string, keyId: string): Promise<void> {
  await query(
    `UPDATE api_keys
        SET revoked_at = now(), sync_state = 'revoked'
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [keyId, userId],
  );
}

async function markRevokePending(userId: string, keyId: string): Promise<void> {
  await query(
    `UPDATE api_keys
        SET sync_state = 'revoke_pending'
      WHERE id = $1
        AND user_id = $2
        AND revoked_at IS NULL
        AND sync_state <> 'revoked'`,
    [keyId, userId],
  );
}

/**
 * Creates a local key row first (state=pending), then mirrors it to Sub2API and
 * finally flips it to active. The old order (remote first) could leave a live
 * remote key without a local row when the process died between the two writes.
 * A pending row is harmless and is cleaned up by reconcilePendingKeyProvisions.
 */
export async function createKeyForUser(
  userId: string,
  rawName: string,
): Promise<{ id: string; key: string; prefix: string }> {
  const name = rawName.trim();
  if (!name) throw new KeyActionError("请输入 Key 名称");
  if (name.length > 40) throw new KeyActionError("名称过长");

  const count = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  if (toNumber(count.rows[0]?.count) >= config.maxActiveApiKeys) {
    throw new KeyActionError(`最多同时保留 ${config.maxActiveApiKeys} 个可用 Key`);
  }

  const generated = generateApiKey();
  const localId = randomUUID();

  if (!isSub2ApiConfigured()) {
    await query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, sync_state)
       VALUES ($1, $2, $3, $4, $5, 'legacy')`,
      [localId, userId, name, generated.hash, generated.prefix],
    );
    return { id: localId, key: generated.key, prefix: generated.prefix };
  }

  // Persist the intent before calling the remote API. This is the compensation
  // anchor if the process crashes mid-provision.
  try {
    await query(
      `INSERT INTO api_keys
        (id, user_id, name, key_hash, key_prefix, sync_state, gateway_group_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [
        localId,
        userId,
        name,
        generated.hash,
        generated.prefix,
        config.sub2apiGroupId || null,
      ],
    );
  } catch {
    throw new KeyActionError("创建 Key 失败，请稍后重试");
  }

  let remote:
    | { identity: GatewayIdentity; remote: Sub2ApiApiKey }
    | null = null;
  try {
    remote = await createRemoteKey(userId, name, generated.key);
  } catch (error) {
    // The remote create can succeed even when the response is lost. Look for a
    // remote key matching our freshly generated plaintext before giving up.
    remote = await findRemoteKeyByPlaintext(userId, generated.key);
    if (!remote) {
      await query(
        "DELETE FROM api_keys WHERE id = $1 AND user_id = $2 AND sync_state = 'pending' AND revoked_at IS NULL",
        [localId, userId],
      );
      console.error(
        "[keys] remote create failed",
        error instanceof Error ? error.message : error,
      );
      throw new KeyActionError("网关暂时不可用，请稍后重试", error);
    }
  }

  try {
    const remoteId = sub2ApiPathId(remote.remote.id);
    const updated = await query<{ id: string }>(
      `UPDATE api_keys
          SET sub2api_key_id = $2, sync_state = 'active'
        WHERE id = $1
          AND user_id = $3
          AND revoked_at IS NULL
          AND sync_state = 'pending'
        RETURNING id`,
      [localId, remoteId, userId],
    );

    if (!updated.rows[0]) {
      // The user revoked the key while we were provisioning it.
      await deleteRemoteKey(userId, remote.identity, remote.remote.id).catch(() => {});
      throw new KeyActionError("Key 已被撤销，请重新创建");
    }
  } catch (error) {
    // Compensate the remote key and the local pending row on any local write
    // failure so no live orphan is left behind.
    try {
      await deleteRemoteKey(userId, remote.identity, remote.remote.id);
    } catch (cleanupError) {
      console.error(
        "[keys] cleanup failed after local activation error",
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    }
    await query(
      "DELETE FROM api_keys WHERE id = $1 AND user_id = $2 AND sync_state = 'pending' AND revoked_at IS NULL",
      [localId, userId],
    ).catch(() => {});
    if (error instanceof KeyActionError) throw error;
    console.error("[keys] local activation failed", error);
    throw new KeyActionError("创建 Key 失败，请稍后重试", error);
  }

  return { id: localId, key: generated.key, prefix: generated.prefix };
}

export type RevokeResult = "revoked" | "revoke_pending" | "not_found";

/**
 * Revokes a locally listed key. A key that still exists in Sub2API is never
 * shown as revoked: if the identity is not active, or the remote delete fails
 * with anything other than 404, the row stays in revoke_pending for retry.
 */
export async function revokeKeyForUser(
  userId: string,
  keyId: string,
): Promise<RevokeResult> {
  const result = await query<KeyRow>(
    `SELECT id, user_id, sub2api_key_id, sync_state, revoked_at
       FROM api_keys
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      LIMIT 1`,
    [keyId, userId],
  );
  const key = result.rows[0];
  if (!key) return "not_found";

  if (!hasSub2ApiId(key.sub2api_key_id)) {
    // Local-only key, or a pending provision. The activation UPDATE refuses to
    // touch revoked rows, so a concurrent provision compensates itself.
    await markRevoked(userId, keyId);
    return "revoked";
  }

  const identity = await getGatewayIdentity(userId);
  if (
    identity?.state !== "active" ||
    !hasSub2ApiId(identity.sub2api_user_id)
  ) {
    await markRevokePending(userId, keyId);
    return "revoke_pending";
  }

  try {
    await deleteRemoteKey(userId, identity, key.sub2api_key_id);
  } catch (error) {
    const status = error instanceof Sub2ApiError ? error.status : undefined;
    if (status !== 404) {
      console.error(
        "[keys] remote revoke failed",
        error instanceof Error ? error.message : error,
      );
      await markRevokePending(userId, keyId);
      return "revoke_pending";
    }
  }

  await markRevoked(userId, keyId);
  return "revoked";
}

/**
 * Retries keys stuck in revoke_pending. Safe to call repeatedly; only the row
 * that is still pending and unrevoked is updated.
 */
export async function retryPendingKeyRevocations(limit = 20): Promise<{
  checked: number;
  revoked: number;
  pending: number;
  errors: number;
}> {
  const result = await query<
    KeyRow & {
      state: string;
      sub2api_email: string;
      password_encrypted: string;
      identity_user_id: string | null;
      identity_remote_id: Sub2ApiId | null;
    }
  >(
    `SELECT k.id, k.user_id, k.sub2api_key_id, k.sync_state, k.revoked_at,
            gi.state, gi.sub2api_email, gi.password_encrypted,
            gi.user_id AS identity_user_id,
            gi.sub2api_user_id AS identity_remote_id
       FROM api_keys k
       LEFT JOIN gateway_identities gi ON gi.user_id = k.user_id
      WHERE k.sync_state = 'revoke_pending'
        AND k.revoked_at IS NULL
      ORDER BY k.created_at
      LIMIT $1`,
    [limit],
  );

  let revoked = 0;
  let pending = 0;
  let errors = 0;

  for (const row of result.rows) {
    if (
      row.state !== "active" ||
      !hasSub2ApiId(row.identity_remote_id) ||
      !hasSub2ApiId(row.sub2api_key_id) ||
      !row.identity_user_id
    ) {
      pending += 1;
      continue;
    }

    const identity: GatewayIdentity = {
      user_id: row.identity_user_id,
      sub2api_user_id: row.identity_remote_id,
      sub2api_email: row.sub2api_email,
      password_encrypted: row.password_encrypted,
      state: "active",
      last_error: null,
      provisioned_at: null,
    };

    try {
      await deleteRemoteKey(row.user_id, identity, row.sub2api_key_id);
      await markRevoked(row.user_id, row.id);
      revoked += 1;
    } catch (error) {
      if (error instanceof Sub2ApiError && error.status === 404) {
        await markRevoked(row.user_id, row.id);
        revoked += 1;
      } else {
        errors += 1;
        console.error(
          "[keys] revoke retry failed",
          row.id,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return { checked: result.rows.length, revoked, pending, errors };
}

/**
 * Cleans up provisions that never reached "active" (process crash between the
 * remote create and the local activation). Any matching remote key is deleted
 * because its plaintext was never returned to the user; otherwise retries just
 * accumulate inaccessible orphans.
 */
export async function reconcilePendingKeyProvisions(
  limit = 20,
  olderThanSeconds = 120,
): Promise<{ checked: number; cleaned: number; failed: number }> {
  if (!isSub2ApiConfigured()) return { checked: 0, cleaned: 0, failed: 0 };

  const result = await query<{
    id: string;
    user_id: string;
    key_hash: string;
  }>(
    `SELECT id, user_id, key_hash
       FROM api_keys
      WHERE sync_state = 'pending'
        AND sub2api_key_id IS NULL
        AND revoked_at IS NULL
        AND created_at < now() - make_interval(secs => $1)
      ORDER BY created_at
      LIMIT $2`,
    [olderThanSeconds, limit],
  );

  let cleaned = 0;
  let failed = 0;
  const remoteByUser = new Map<string, Sub2ApiApiKey[]>();

  for (const row of result.rows) {
    try {
      let identity = await getGatewayIdentity(row.user_id);
      if (!identity || identity.state !== "active" || !hasSub2ApiId(identity.sub2api_user_id)) {
        identity = await ensureGatewayIdentityReady(row.user_id);
      }

      let remoteKeys = remoteByUser.get(row.user_id);
      if (!remoteKeys) {
        remoteKeys = await listRemoteKeys(row.user_id, identity);
        remoteByUser.set(row.user_id, remoteKeys);
      }

      const matches = remoteKeys.filter(
        (item) => looksLikeFullKey(item.key) && sha256(item.key) === row.key_hash,
      );

      let remoteDeleted = true;
      for (const match of matches) {
        try {
          await deleteRemoteKey(row.user_id, identity, match.id);
        } catch (error) {
          if (!(error instanceof Sub2ApiError && error.status === 404)) {
            remoteDeleted = false;
            throw error;
          }
        }
      }

      if (!remoteDeleted) {
        failed += 1;
        continue;
      }

      const updated = await query(
        `UPDATE api_keys
            SET revoked_at = now(), sync_state = 'revoked'
          WHERE id = $1
            AND user_id = $2
            AND sync_state = 'pending'
            AND sub2api_key_id IS NULL
            AND revoked_at IS NULL`,
        [row.id, row.user_id],
      );
      if (updated.rowCount) cleaned += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "[keys] pending provision reconciliation failed",
        row.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { checked: result.rows.length, cleaned, failed };
}
