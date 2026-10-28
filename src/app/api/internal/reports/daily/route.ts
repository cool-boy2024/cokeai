import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { formatCny } from "@/lib/money";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";
import { getAdminDashboardStats } from "@/lib/sub2api/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const overview = await query<{
      revenue: string;
      paid_orders: string;
      new_users: string;
      pending_orders: string;
      pending_ops: string;
      failed_ops: string;
      active_prices: string;
      paused_prices: string;
      commission_pending: string;
      commission_available: string;
    }>(
      `SELECT
        COALESCE((SELECT SUM(amount_micros) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '24 hours'), 0) AS revenue,
        (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND paid_at >= now() - interval '24 hours') AS paid_orders,
        (SELECT COUNT(*) FROM users WHERE created_at >= now() - interval '24 hours') AS new_users,
        (SELECT COUNT(*) FROM orders WHERE status = 'pending' AND created_at < now() - interval '2 hours') AS pending_orders,
        (SELECT COUNT(*) FROM gateway_balance_ops WHERE status IN ('pending', 'applying')) AS pending_ops,
        (SELECT COUNT(*) FROM gateway_balance_ops WHERE status = 'failed') AS failed_ops,
        (SELECT COUNT(*) FROM model_prices_current WHERE status = 'active') AS active_prices,
        (SELECT COUNT(*) FROM model_prices_current WHERE status = 'paused') AS paused_prices,
        COALESCE((SELECT SUM(amount_micros) FROM commissions WHERE status = 'pending'), 0) AS commission_pending,
        COALESCE((SELECT SUM(amount_micros) FROM commissions WHERE status = 'available'), 0) AS commission_available`,
    );

    // Usage is authoritative in Sub2API. Dashboard "today" values are used for
    // the daily digest; the previous local usage_events table is legacy and is
    // no longer written by the public gateway.
    let gatewayStats: Awaited<ReturnType<typeof getAdminDashboardStats>> | null = null;
    let gatewayError: string | null = null;
    if (isSub2ApiConfigured()) {
      try {
        gatewayStats = await getAdminDashboardStats();
      } catch (error) {
        gatewayError = error instanceof Error ? error.message : "gateway_stats_failed";
      }
    }

    const row = overview.rows[0];
    const todayCostMicros = Math.round(
      Number(gatewayStats?.today_actual_cost || 0) * 1_000_000,
    );

    return Response.json(
      {
        period: "last_24_hours",
        generated_at: new Date().toISOString(),
        revenue_micros: toNumber(row.revenue),
        revenue: formatCny(row.revenue),
        paid_orders: toNumber(row.paid_orders),
        new_users: toNumber(row.new_users),
        // Gateway usage (today, Sub2API timezone Asia/Shanghai).
        requests: toNumber(gatewayStats?.today_requests),
        failures: 0,
        input_tokens: 0,
        output_tokens: 0,
        charged_micros: todayCostMicros,
        upstream_cost_micros: 0,
        gross_margin_micros: 0,
        today_tokens: toNumber(gatewayStats?.today_tokens),
        total_requests: toNumber(gatewayStats?.total_requests),
        total_actual_cost_micros: Math.round(
          Number(gatewayStats?.total_actual_cost || 0) * 1_000_000,
        ),
        gateway_error: gatewayError,
        pending_orders_older_than_2h: toNumber(row.pending_orders),
        credit_ops_pending: toNumber(row.pending_ops),
        credit_ops_failed: toNumber(row.failed_ops),
        prices_active: toNumber(row.active_prices),
        prices_paused: toNumber(row.paused_prices),
        commission_pending_micros: toNumber(row.commission_pending),
        commission_available_micros: toNumber(row.commission_available),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal-daily]", error);
    return Response.json({ error: "report_failed" }, { status: 500 });
  }
}
