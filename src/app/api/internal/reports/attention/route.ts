import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    // Low balance is the only user-facing funding signal now: credits do not
    // expire, so legacy plan_expires_at must not gate this report.
    const lowBalance = await query<{
      email: string;
      name: string;
      balance_micros: string;
      gateway_balance_synced_at: string | null;
    }>(
      `SELECT u.email, u.name, u.balance_micros, u.gateway_balance_synced_at
         FROM users u
         JOIN gateway_identities gi ON gi.user_id = u.id AND gi.state = 'active'
        WHERE u.status = 'active'
          AND u.balance_micros < 2000000
        ORDER BY u.balance_micros
        LIMIT 50`,
    );

    const staleOrders = await query<{
      id: string;
      email: string;
      amount_micros: string;
      payment_provider: string;
      created_at: string;
    }>(
      `SELECT o.id, u.email, o.amount_micros, o.payment_provider, o.created_at
         FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.status = 'pending'
          AND o.created_at < now() - interval '2 hours'
        ORDER BY o.created_at
        LIMIT 50`,
    );

    const [prices, ops] = await Promise.all([
      query<{ status: string; count: string }>(
        "SELECT status, COUNT(*)::text AS count FROM model_prices_current GROUP BY status",
      ),
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count
           FROM gateway_balance_ops
          WHERE status IN ('pending', 'applying', 'failed')
          GROUP BY status`,
      ),
    ]);

    return Response.json(
      {
        generated_at: new Date().toISOString(),
        low_balance: lowBalance.rows.map((item) => ({
          email: item.email,
          name: item.name,
          balance_micros: toNumber(item.balance_micros),
          balance_synced_at: item.gateway_balance_synced_at,
        })),
        stale_pending_orders: staleOrders.rows.map((item) => ({
          id: item.id,
          email: item.email,
          amount_micros: toNumber(item.amount_micros),
          provider: item.payment_provider,
          created_at: item.created_at,
        })),
        prices: Object.fromEntries(
          prices.rows.map((item) => [item.status, Number(item.count)]),
        ),
        credit_ops: Object.fromEntries(
          ops.rows.map((item) => [item.status, Number(item.count)]),
        ),
        ready_models: Number(
          prices.rows.find((item) => item.status === "active")?.count || 0,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal-attention]", error);
    return Response.json({ error: "report_failed" }, { status: 500 });
  }
}
