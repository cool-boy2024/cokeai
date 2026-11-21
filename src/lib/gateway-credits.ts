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

export const SHOP_BALANCE_REF_PREFIX = "cokeai-shop-balance:";
export const SHOP_BALANCE_REVERSED = "SHOP_BALANCE_REVERSED";
export const SHOP_BALANCE_REVERSAL_FAILED = "SHOP_BALANCE_REVERSAL_FAILED";

export function shopBalanceReference(orderId: string, attempt = 1): string {
  return attempt <= 1
    ? `${SHOP_BALANCE_REF_PREFIX}${orderId}`
    : `${SHOP_BALANCE_REF_PREFIX}${orderId}:${attempt}`;
}

export function shopBalanceAttempt(reference: string): number {
  const rest = reference.slice(SHOP_BALANCE_REF_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  if (separator < 0) return 1;
  const attempt = Number(rest.slice(separator + 1));
  return Number.isInteger(attempt) && attempt > 1 ? attempt : 1;
}

/**
 * A shop-balance debit that is still in flight, already applied, or in an
 * unresolved failure must not close the order. Only a clean insufficient
 * refusal or a completed reversal may expire/cancel.
 */
export function shopBalanceOpBlocksClose(
  op: Pick<CreditOp, "status" | "last_error"> | null,
): boolean {
  if (!op) return false;
  if (op.status !== "failed") return true;
  const error = op.last_error || "";
  return !(
    error === "INSUFFICIENT_BALANCE" ||
    error === SHOP_BALANCE_REVERSED ||
    error.startsWith(`${SHOP_BALANCE_REVERSED}：`)
  );
}

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

export async function getCreditOpByReference(
  reference: string,
  client?: PoolClient,
): Promise<CreditOp | null> {
  const sql = `SELECT id, user_id, order_id, kind, amount_cny_micros, amount_credit,
            reference, status, attempts, last_error, sub2api_user_id
       FROM gateway_balance_ops WHERE reference = $1`;
  const result = client
    ? await client.query<CreditOp>(sql, [reference])
    : await query<CreditOp>(sql, [reference]);
  return result.rows[0] || null;
}

export async function getLatestShopBalanceOp(
  orderId: string,
  client?: PoolClient,
): Promise<CreditOp | null> {
  const base = shopBalanceReference(orderId);
  const sql = `SELECT id, user_id, order_id, kind, amount_cny_micros, amount_credit,
            reference, status, attempts, last_error, sub2api_user_id
       FROM gateway_balance_ops
      WHERE reference = $1 OR reference LIKE $1 || ':%'
      ORDER BY created_at DESC
      LIMIT 1`;
  const result = client
    ? await client.query<CreditOp>(sql, [base])
    : await query<CreditOp>(sql, [base]);
  return result.rows[0] || null;
}

async function markFailed(claimedOp: CreditOp, message: string): Promise<CreditOp> {
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

async function reverseShopBalance(
  claimedOp: CreditOp,
  sub2apiUserId: Sub2ApiId,
  signed: number,
): Promise<CreditOp> {
  try {
    const reference = `${claimedOp.reference}:reversal`;
    const profile = await adminRequest<Sub2ApiProfile>(
      `/api/v1/admin/users/${sub2ApiPathId(sub2apiUserId)}/balance`,
      {
        method: "POST",
        idempotencyKey: reference,
        body: {
          balance: Math.abs(signed),
          operation: "add",
          notes: reference,
        },
      },
    );
    await updateLocalBalance(claimedOp.user_id, toNumber(profile.balance));
    return markFailed(
      claimedOp,
      `${SHOP_BALANCE_REVERSED}：余额不足，扣款已自动冲正`,
    );
  } catch (error) {
    console.error(
      "[gateway-credits] shop balance reversal failed",
      claimedOp.reference,
      error instanceof Error ? error.message : error,
    );
    return markFailed(
      claimedOp,
      `${SHOP_BALANCE_REVERSAL_FAILED}：扣款后余额为负且冲正失败，需人工核对`,
    );
  }
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

type ApplyCreditOpOptions = { requireNonNegative?: boolean };

async function applyCreditOp(
  op: CreditOp,
  options: ApplyCreditOpOptions = {},
): Promise<CreditOp> {
  if (
    options.requireNonNegative &&
    (op.last_error === SHOP_BALANCE_REVERSED ||
      op.last_error === SHOP_BALANCE_REVERSAL_FAILED ||
      op.last_error?.startsWith(`${SHOP_BALANCE_REVERSED}：`) ||
      op.last_error?.startsWith(`${SHOP_BALANCE_REVERSAL_FAILED}：`))
  ) {
    // Do not replay a debit that was already reversed (the original reference
    // still appears in Sub2API balance history) or one whose reversal failed.
    return op;
  }

  const claimed = await query<CreditOp>(
    `UPDATE gateway_balance_ops
        SET status = 'applying', attempts = attempts + 1, updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'failed')
        AND (
          NOT $2::boolean
          OR last_error IS NULL
          OR (
            last_error NOT LIKE $3
            AND last_error NOT LIKE $4
          )
        )
      RETURNING id, user_id, order_id, kind, amount_cny_micros, amount_credit,
                reference, status, attempts, last_error, sub2api_user_id`,
    [
      op.id,
      Boolean(options.requireNonNegative),
      `${SHOP_BALANCE_REVERSED}%`,
      `${SHOP_BALANCE_REVERSAL_FAILED}%`,
    ],
  );
  const claimedOp = claimed.rows[0];
  // A terminal reversal/refusal never gets claimed into 'applying': the row is
  // left as failed so the original debit can never be replayed.
  if (!claimedOp) return (await getCreditOp(op.id)) || op;

  try {
    const signed = toNumber(claimedOp.amount_credit);
    if (!Number.isFinite(signed) || signed === 0) {
      throw new Error("额度变化为 0");
    }

    // Legacy/CI/rollback mode: no Sub2API configured. Keep the old local
    // balance authoritative and still mark the outbox row atomically so a
    // retry cannot double-credit. A shop debit additionally requires the
    // resulting local balance to stay non-negative.
    if (!isSub2ApiConfigured()) {
      await withTransaction(async (client) => {
        const delta = creditToMicros(signed);
        if (options.requireNonNegative && delta < 0) {
          const updated = await client.query(
            `UPDATE users
                SET balance_micros = balance_micros + $2::bigint,
                    gateway_balance_synced_at = now(),
                    updated_at = now()
              WHERE id = $1 AND balance_micros + $2::bigint >= 0`,
            [claimedOp.user_id, delta],
          );
          if (!updated.rowCount) {
            await client.query(
              `UPDATE gateway_balance_ops
                  SET status = 'failed', last_error = 'INSUFFICIENT_BALANCE',
                      updated_at = now()
                WHERE id = $1 AND status = 'applying'`,
              [claimedOp.id],
            );
            return;
          }
        } else {
          await client.query(
            `UPDATE users
                SET balance_micros = GREATEST(0, balance_micros + $2),
                    gateway_balance_synced_at = now(),
                    updated_at = now()
              WHERE id = $1`,
            [claimedOp.user_id, delta],
          );
        }
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
      if (options.requireNonNegative && toNumber(profile.balance) < 0) {
        return reverseShopBalance(claimedOp, sub2apiUserId, signed);
      }
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

    if (options.requireNonNegative && toNumber(profile.balance) < 0) {
      return reverseShopBalance(claimedOp, sub2apiUserId, signed);
    }
    await updateLocalBalance(claimedOp.user_id, toNumber(profile.balance));
    return markApplied(claimedOp, sub2apiUserId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "加额度失败";
    return markFailed(claimedOp, message);
  }
}

export async function applyCreditOpById(
  id: string,
  options: ApplyCreditOpOptions = {},
): Promise<CreditOp | null> {
  const op = await getCreditOp(id);
  if (!op) return null;
  if (op.status === "applied") return op;
  return applyCreditOp(op, options);
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
        -- Shop debits are driven by the checkout request, never by the
        -- background retry worker: a retry must not charge a buyer after the
        -- order was cancelled or left pending.
        AND reference NOT LIKE 'cokeai-shop-balance:%'
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
