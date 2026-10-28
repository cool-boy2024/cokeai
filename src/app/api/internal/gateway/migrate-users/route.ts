import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { applyCreditOpById, enqueueAdjustment } from "@/lib/gateway-credits";
import { ensureGatewayIdentity } from "@/lib/sub2api/identity";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LegacyUser = {
  id: string;
  email: string;
  status: string;
  balance_micros: string;
  identity_state: string | null;
  sub2api_user_id: string | null;
};

/**
 * One-shot, idempotent cutover helper.
 *
 * Creates the Sub2API mirror user for each active CokeAI user and moves the
 * legacy local balance into Sub2API through the normal funding outbox. The
 * reference is stable per user, so running this endpoint twice cannot
 * double-credit. It does not touch API keys: legacy keys keep working on the
 * old gateway until the Cloudflare origin is switched.
 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  if (!isSub2ApiConfigured()) {
    return Response.json({ ok: false, error: "SUB2API_NOT_CONFIGURED" }, { status: 400 });
  }

  const users = await query<LegacyUser>(
    `SELECT u.id, u.email, u.status, u.balance_micros,
            gi.state AS identity_state, gi.sub2api_user_id
       FROM users u
       LEFT JOIN gateway_identities gi ON gi.user_id = u.id
      WHERE u.status = 'active'
      ORDER BY u.created_at`,
  );

  let identities = 0;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const details: Array<{
    email: string;
    identity: string;
    credit: string;
    error?: string;
  }> = [];

  for (const user of users.rows) {
    const label = user.email;
    try {
      const identity = await ensureGatewayIdentity(user.id);
      identities += 1;

      const credit = toNumber(user.balance_micros) / 1_000_000;
      if (credit <= 0) {
        skipped += 1;
        details.push({ email: label, identity: identity.state, credit: "0" });
        continue;
      }

      const reference = `cokeai-migrate:${user.id}`;
      const existing = await query<{ status: string }>(
        "SELECT status FROM gateway_balance_ops WHERE reference = $1 LIMIT 1",
        [reference],
      );
      if (existing.rows[0]) {
        skipped += 1;
        details.push({
          email: label,
          identity: identity.state,
          credit: String(credit),
          error: `already ${existing.rows[0].status}`,
        });
        continue;
      }

      const op = await enqueueAdjustment({
        userId: user.id,
        amountMicros: Number(user.balance_micros),
        reference,
      });
      const result = await applyCreditOpById(op.id);
      if (result?.status === "applied") {
        applied += 1;
        details.push({ email: label, identity: identity.state, credit: String(credit) });
      } else {
        failed += 1;
        details.push({
          email: label,
          identity: identity.state,
          credit: String(credit),
          error: result?.last_error || result?.status || "not_applied",
        });
      }
    } catch (error) {
      failed += 1;
      details.push({
        email: label,
        identity: user.identity_state || "unknown",
        credit: String(toNumber(user.balance_micros) / 1_000_000),
        error: error instanceof Error ? error.message : "migration_failed",
      });
    }
  }

  return Response.json(
    {
      ok: failed === 0,
      checked: users.rows.length,
      identities,
      applied,
      skipped,
      failed,
      details,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
