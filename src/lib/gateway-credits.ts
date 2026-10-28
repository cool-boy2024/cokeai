import type { PoolClient } from "pg";
import { cache } from "react";
import { query, toNumber, withTransaction } from "@/lib/db";
import { adminRequest } from "@/lib/sub2api/auth";
import {
  hasSub2ApiId,
  isSub2ApiConfigured,
  sub2ApiPathId,
  type Sub2ApiId,
  type Sub2ApiProfile,
} from "@/lib/sub2api/client";
import { ensureGatewayIdentityReady } from "@/lib/sub2api/identity";

export type CreditOp = {
  id: string;
  user_id: string;
  order_id: string | null;
  kind: "topup" | "adjustment" | "refund";
  amount_cny_micros: string | number;
  amount_credit: string | number;
  reference: string;
  status: "pending" | "applying" | "applied" | "failed";
  attempts: number;
  last_error: string | null;
  sub2api_user_id: Sub2ApiId | null;
};

type BalanceHistoryItem = {
  notes?: string;
  value?: number;
  created_at?: string;
};

export function microsToCredit(micros: number): number {
  return Math.round(micros) / 1_000_000;
}

export function creditToMicros(credit: number): number {
  return Math.round(credit * 1_000_000);
}

/**
 * Must be called inside the same transaction that marks the order paid.
 */
export async function enqueueTopup(
  client: PoolClient,
  input: {
    userId: string;
    orderId: string;
    creditsMicros: number;
    sub2apiUserId?: Sub2ApiId | null;
  },
): Promise<CreditOp> {
  const amountCredit = microsToCredit(input.creditsMicros);
  const reference = `cokeai-order:${input.orderId}`;
  const inserted = await client.query<CreditOp>(
    `INSERT INTO gateway_balance_ops
      (user_id, order_id, kind, amount_cny_micros, amount_credit, reference,
       sub2api_user_id, status)
     VALUES ($1, $2, 'topup', $3, $4, $5, $6, 'pending')
     ON CONFLICT (order_id) DO UPDATE SET updated_at = now()
     RETURNING id, user_id, order_id, kind, amount_cny_micros, amount_credit,
               reference, status, attempts, last_error, sub2api_user_id`,
    [
      input.userId,
      input.orderId,
      input.creditsMicros,
      amountCredit,
      reference,
      hasSub2ApiId(input.sub2apiUserId) ? String(input.sub2apiUserId) : null,
    ],
  );
  return inserted.rows[0];
}

export async function enqueueAdjustment(
  input: {
    userId: string;
    amountMicros: number;
    reference: string;
  },
  client?: PoolClient,
): Promise<CreditOp> {
  if (!Number.isFinite(input.amountMicros) || Math.round(input.amountMicros) === 0) {
    throw new Error("调整金额不能为 0");
  }
  if (!input.reference.trim()) throw new Error("调整缺少流水号");

  const amountMicros = Math.round(input.amountMicros);
  const amountCredit = microsToCredit(amountMicros);
  // amount_credit keeps the sign; applyCreditOp maps it to add/subtract.
  const sql = `INSERT INTO gateway_balance_ops
      (user_id, kind, amount_cny_micros, amount_credit, reference, status)
     VALUES ($1, 'adjustment', $2, $3, $4, 'pending')
     RETURNING id, user_id, order_id, kind, amount_cny_micros, amount_credit,
               reference, status, attempts, last_error, sub2api_user_id`;
  const params = [input.userId, amountMicros, amountCredit, input.reference];
  const inserted = client
    ? await client.query<CreditOp>(sql, params)
    : await query<CreditOp>(sql, params);
  return inserted.rows[0];
}

async function hasAppliedReference(
  sub2apiUserId: Sub2ApiId,
  reference: string,
): Promise<boolean> {
  const target = reference.trim();
  const pathId = sub2ApiPathId(sub2apiUserId);

  // Sub2API exposes admin balance history; scan a bounded number of pages so an
  // older successful write is still detected on retry.
  for (let page = 1; page <= 5; page += 1) {
    const data = await adminRequest<{
      items?: BalanceHistoryItem[];
    } | BalanceHistoryItem[]>(
      `/api/v1/admin/users/${pathId}/balance-history?type=admin_balance&page=${page}&page_size=100`,
    );
    const items = Array.isArray(data) ? data : data.items || [];
    if (items.some((item) => (item.notes || "").trim() === target)) return true;
    if (items.length < 100) break;
  }
  return false;
}

async function updateLocalBalance(userId: string, balanceCredit: number): Promise<void> {
  // users.balance_micros is a display/session mirror and has a CHECK >= 0,
  // while Sub2API permits a negative balance. Clamp the mirror instead of
  // failing the outbox operation after the remote write already succeeded.
  const micros = Math.max(0, creditToMicros(balanceCredit));
  await query(
    `UPDATE users
        SET balance_micros = $2,
            gateway_balance_synced_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [userId, micros],
  );
}

async function getCreditOp(id: string): Promise<CreditOp | null> {
  const result = await query<CreditOp>(
    `SELECT id, user_id, order_id, kind, amount_cny_micros, amount_credit,
            reference, status, attempts, last_error, sub2api_user_id
       FROM gateway_balance_ops WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function markApplied(claimedOp: CreditOp, sub2apiUserId: Sub2ApiId): Promise<CreditOp> {
  const applied = await query<CreditOp>(
    `UPDATE gateway_balance_ops
        SET status = 'applied', sub2api_user_id = $2,
            applied_at = coalesce(applied_at, now()), last_error = NULL,
            updated_at = now()
      WHERE id = $1 AND status = 'applying'
      RETURNING id, user_id, order_id, kind, amount_cny_micros, amount_credit,
                reference, status, attempts, last_error, sub2api_user_id`,
    [claimedOp.id, String(sub2apiUserId)],
  );
  return applied.rows[0] || (await getCreditOp(claimedOp.id)) || claimedOp;
}

async function applyCreditOp(op: CreditOp): Promise<CreditOp> {
  const claimed = await query<CreditOp>(
    `UPDATE gateway_balance_ops
        SET status = 'applying', attempts = attempts + 1, updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'failed')
      RETURNING id, user_id, order_id, kind, amount_cny_micros, amount_credit,
                reference, status, attempts, last_error, sub2api_user_id`,
    [op.id],
  );
  const claimedOp = claimed.rows[0];
  if (!claimedOp) return (await getCreditOp(op.id)) || op;

  try {
    const signed = toNumber(claimedOp.amount_credit);
    if (!Number.isFinite(signed) || signed === 0) {
      throw new Error("额度变化为 0");
    }

    // Legacy/CI/rollback mode: no Sub2API configured. Keep the old local
    // balance authoritative and still mark the outbox row atomically so a
    // retry cannot double-credit.
    if (!isSub2ApiConfigured()) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users
              SET balance_micros = GREATEST(0, balance_micros + $2),
                  gateway_balance_synced_at = now(),
                  updated_at = now()
            WHERE id = $1`,
          [claimedOp.user_id, creditToMicros(signed)],
        );
        await client.query(
          `UPDATE gateway_balance_ops
              SET status = 'applied', applied_at = coalesce(applied_at, now()),
                  last_error = NULL, updated_at = now()
            WHERE id = $1 AND status = 'applying'`,
          [claimedOp.id],
        );
      });
      return (await getCreditOp(claimedOp.id)) || claimedOp;
    }

    const identity = await ensureGatewayIdentityReady(claimedOp.user_id);
    const sub2apiUserId = hasSub2ApiId(claimedOp.sub2api_user_id)
      ? claimedOp.sub2api_user_id
      : identity.sub2api_user_id;
    if (!hasSub2ApiId(sub2apiUserId)) throw new Error("网关用户未就绪");

    if (await hasAppliedReference(sub2apiUserId, claimedOp.reference)) {
      // The remote write already succeeded on a previous attempt; only local state was lost.
      const profile = await adminRequest<Sub2ApiProfile>(
        `/api/v1/admin/users/${sub2ApiPathId(sub2apiUserId)}`,
      );
      await updateLocalBalance(claimedOp.user_id, toNumber(profile.balance));
      return markApplied(claimedOp, sub2apiUserId);
    }

    const profile = await adminRequest<Sub2ApiProfile>(
      `/api/v1/admin/users/${sub2ApiPathId(sub2apiUserId)}/balance`,
      {
        method: "POST",
        idempotencyKey: claimedOp.reference,
        body: {
          balance: Math.abs(signed),
          operation: signed > 0 ? "add" : "subtract",
          notes: claimedOp.reference,
        },
      },
    );

    await updateLocalBalance(claimedOp.user_id, toNumber(profile.balance));
    return markApplied(claimedOp, sub2apiUserId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "加额度失败";
    const failed = await query<CreditOp>(
      `UPDATE gateway_balance_ops
          SET status = 'failed', last_error = $2, updated_at = now()
        WHERE id = $1 AND status = 'applying'
        RETURNING id, user_id, order_id, kind, amount_cny_micros, amount_credit,
                  reference, status, attempts, last_error, sub2api_user_id`,
      [claimedOp.id, message.slice(0, 500)],
    );
    return failed.rows[0] || (await getCreditOp(claimedOp.id)) || claimedOp;
  }
}

export async function applyCreditOpById(id: string): Promise<CreditOp | null> {
  const op = await getCreditOp(id);
  if (!op) return null;
  if (op.status === "applied") return op;
  return applyCreditOp(op);
}

/**
 * Reclaims operations whose worker died while status='applying'. Five minutes
 * is comfortably longer than the Sub2API request timeout.
 */
export async function recoverStaleCreditOps(): Promise<number> {
  const result = await query(
    `UPDATE gateway_balance_ops
        SET status = 'failed',
            last_error = coalesce(last_error, '处理超时，已重新排队'),
            updated_at = now()
      WHERE status = 'applying'
        AND updated_at < now() - interval '5 minutes'`,
  );
  return result.rowCount || 0;
}

export async function retryPendingCreditOps(limit = 20): Promise<{
  checked: number;
  applied: number;
  failed: number;
}> {
  await recoverStaleCreditOps();

  const result = await query<CreditOp>(
    `SELECT id, user_id, order_id, kind, amount_cny_micros, amount_credit,
            reference, status, attempts, last_error, sub2api_user_id
       FROM gateway_balance_ops
      WHERE status IN ('pending', 'failed')
        AND attempts < 10
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );

  let applied = 0;
  let failed = 0;
  for (const op of result.rows) {
    const next = await applyCreditOp(op);
    if (next.status === "applied") applied += 1;
    else if (next.status === "failed") failed += 1;
  }
  return { checked: result.rows.length, applied, failed };
}

export async function getGatewayBalance(userId: string): Promise<{
  balance: number;
  syncedAt: string;
  source: "gateway" | "local";
}> {
  if (!isSub2ApiConfigured()) {
    const local = await query<{ balance_micros: string; gateway_balance_synced_at: string | null }>(
      "SELECT balance_micros, gateway_balance_synced_at FROM users WHERE id = $1",
      [userId],
    );
    const row = local.rows[0];
    return {
      balance: row ? toNumber(row.balance_micros) / 1_000_000 : 0,
      syncedAt: row?.gateway_balance_synced_at || new Date(0).toISOString(),
      source: "local",
    };
  }

  const identity = await ensureGatewayIdentityReady(userId);
  if (!hasSub2ApiId(identity.sub2api_user_id)) throw new Error("网关用户未就绪");
  try {
    const profile = await adminRequest<Sub2ApiProfile>(
      `/api/v1/admin/users/${sub2ApiPathId(identity.sub2api_user_id)}`,
    );
    await updateLocalBalance(userId, toNumber(profile.balance));
    return {
      balance: toNumber(profile.balance),
      syncedAt: new Date().toISOString(),
      source: "gateway",
    };
  } catch (error) {
    const local = await query<{ balance_micros: string; gateway_balance_synced_at: string | null }>(
      "SELECT balance_micros, gateway_balance_synced_at FROM users WHERE id = $1",
      [userId],
    );
    const row = local.rows[0];
    return {
      balance: row ? toNumber(row.balance_micros) / 1_000_000 : 0,
      syncedAt: row?.gateway_balance_synced_at || new Date(0).toISOString(),
      source: "local",
    };
  }
}

/**
 * Per-request dedupe for server components. Layout and page can both ask for
 * the live balance without making two Sub2API calls.
 */
export const getGatewayBalanceForRequest = cache(getGatewayBalance);

/**
 * Refreshes the stale local balance mirror in bounded batches. Intended for the
 * internal cron route, not for page rendering.
 */
export async function syncStaleGatewayBalances(limit = 50): Promise<{
  checked: number;
  synced: number;
  failed: number;
}> {
  const result = await query<{ user_id: string }>(
    `SELECT gi.user_id
       FROM gateway_identities gi
       JOIN users u ON u.id = gi.user_id
      WHERE gi.state = 'active'
        AND gi.sub2api_user_id IS NOT NULL
        AND (
          u.gateway_balance_synced_at IS NULL
          OR u.gateway_balance_synced_at < now() - interval '10 minutes'
        )
      ORDER BY u.gateway_balance_synced_at NULLS FIRST
      LIMIT $1`,
    [limit],
  );

  let synced = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      const balance = await getGatewayBalance(row.user_id);
      if (balance.source === "gateway") synced += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "[balance-sync]",
        row.user_id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { checked: result.rows.length, synced, failed };
}

export async function listPendingCreditOps(limit = 50): Promise<CreditOp[]> {
  const result = await query<CreditOp>(
    `SELECT id, user_id, order_id, kind, amount_cny_micros, amount_credit,
            reference, status, attempts, last_error, sub2api_user_id
       FROM gateway_balance_ops
      WHERE status IN ('pending', 'failed', 'applying')
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function withCreditOpTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(fn);
}
