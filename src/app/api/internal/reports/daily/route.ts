import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { formatCny } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const overview = await query<{
      revenue: string;
      paid_orders: string;
      new_users: string;
      requests: string;
      input_tokens: string;
      output_tokens: string;
      charged: string;
      upstream_cost: string;
      failures: string;
      pending_orders: string;
      commission_pending: string;
      commission_available: string;
    }>(
      `SELECT
        COALESCE((SELECT SUM(amount_micros) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '24 hours'), 0) AS revenue,
        (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '24 hours') AS paid_orders,
        (SELECT COUNT(*) FROM users WHERE created_at >= now() - interval '24 hours') AS new_users,
        (SELECT COUNT(*) FROM usage_events WHERE created_at >= now() - interval '24 hours') AS requests,
        COALESCE((SELECT SUM(input_tokens) FROM usage_events WHERE created_at >= now() - interval '24 hours' AND status = 'succeeded'), 0) AS input_tokens,
        COALESCE((SELECT SUM(output_tokens) FROM usage_events WHERE created_at >= now() - interval '24 hours' AND status = 'succeeded'), 0) AS output_tokens,
        COALESCE((SELECT SUM(charged_micros) FROM usage_events WHERE created_at >= now() - interval '24 hours' AND status = 'succeeded'), 0) AS charged,
        COALESCE((SELECT SUM(upstream_cost_micros) FROM usage_events WHERE created_at >= now() - interval '24 hours' AND status = 'succeeded'), 0) AS upstream_cost,
        (SELECT COUNT(*) FROM usage_events WHERE created_at >= now() - interval '24 hours' AND status = 'failed') AS failures,
        (SELECT COUNT(*) FROM orders WHERE status = 'pending' AND created_at < now() - interval '2 hours') AS pending_orders,
        COALESCE((SELECT SUM(amount_micros) FROM commissions WHERE status = 'pending'), 0) AS commission_pending,
        COALESCE((SELECT SUM(amount_micros) FROM commissions WHERE status = 'available'), 0) AS commission_available`,
    );

    const topModels = await query<{
      model_id: string;
      requests: string;
      charged: string;
    }>(
      `SELECT model_id, COUNT(*) AS requests, SUM(charged_micros) AS charged
         FROM usage_events
        WHERE created_at >= now() - interval '24 hours'
          AND status = 'succeeded'
        GROUP BY model_id
        ORDER BY charged DESC
        LIMIT 5`,
    );

    const row = overview.rows[0];
    const charged = toNumber(row.charged);
    const upstreamCost = toNumber(row.upstream_cost);

    return Response.json(
      {
        period: "last_24_hours",
        generated_at: new Date().toISOString(),
        revenue_micros: toNumber(row.revenue),
        revenue: formatCny(row.revenue),
        paid_orders: toNumber(row.paid_orders),
        new_users: toNumber(row.new_users),
        requests: toNumber(row.requests),
        failures: toNumber(row.failures),
        input_tokens: toNumber(row.input_tokens),
        output_tokens: toNumber(row.output_tokens),
        charged_micros: charged,
        upstream_cost_micros: upstreamCost,
        gross_margin_micros: charged - upstreamCost,
        pending_orders_older_than_2h: toNumber(row.pending_orders),
        commission_pending_micros: toNumber(row.commission_pending),
        commission_available_micros: toNumber(row.commission_available),
        top_models: topModels.rows.map((item) => ({
          model: item.model_id,
          requests: toNumber(item.requests),
          charged_micros: toNumber(item.charged),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal-daily]", error);
    return Response.json({ error: "report_failed" }, { status: 500 });
  }
}
