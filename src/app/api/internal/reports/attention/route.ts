import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const expiring = await query<{
      email: string;
      name: string;
      plan_name: string | null;
      plan_expires_at: string;
      balance_micros: string;
    }>(
      `SELECT u.email, u.name, p.name AS plan_name, u.plan_expires_at, u.balance_micros
         FROM users u
         LEFT JOIN plans p ON p.id = u.plan_id
        WHERE u.status = 'active'
          AND u.plan_expires_at BETWEEN now() AND now() + interval '3 days'
        ORDER BY u.plan_expires_at
        LIMIT 50`,
    );

    const lowBalance = await query<{
      email: string;
      name: string;
      balance_micros: string;
      plan_expires_at: string;
    }>(
      `SELECT email, name, balance_micros, plan_expires_at
         FROM users
        WHERE status = 'active'
          AND plan_expires_at > now()
          AND balance_micros < 2000000
        ORDER BY balance_micros
        LIMIT 50`,
    );

    const staleOrders = await query<{
      id: string;
      email: string;
      amount_micros: string;
      created_at: string;
    }>(
      `SELECT o.id, u.email, o.amount_micros, o.created_at
         FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.status = 'pending'
          AND o.created_at < now() - interval '2 hours'
        ORDER BY o.created_at
        LIMIT 50`,
    );

    const readyModels = await query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM models m
         JOIN upstreams u ON u.id = m.upstream_id
        WHERE m.enabled = TRUE AND u.enabled = TRUE AND u.api_key_encrypted IS NOT NULL`,
    );

    return Response.json(
      {
        generated_at: new Date().toISOString(),
        expiring_plans: expiring.rows.map((item) => ({
          email: item.email,
          name: item.name,
          plan: item.plan_name,
          expires_at: item.plan_expires_at,
          balance_micros: toNumber(item.balance_micros),
        })),
        low_balance: lowBalance.rows.map((item) => ({
          email: item.email,
          name: item.name,
          balance_micros: toNumber(item.balance_micros),
          plan_expires_at: item.plan_expires_at,
        })),
        stale_pending_orders: staleOrders.rows.map((item) => ({
          id: item.id,
          email: item.email,
          amount_micros: toNumber(item.amount_micros),
          created_at: item.created_at,
        })),
        ready_models: toNumber(readyModels.rows[0]?.count),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal-attention]", error);
    return Response.json({ error: "report_failed" }, { status: 500 });
  }
}
