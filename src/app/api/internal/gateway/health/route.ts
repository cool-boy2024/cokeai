import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { adminRequest, getAdminToken } from "@/lib/sub2api/auth";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupResponse = {
  id: number;
  name: string;
  platform: string;
  rate_multiplier: number;
  status?: string;
};

type ModelPlazaResponse = {
  groups?: Array<{ models?: unknown[] }>;
};

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  let gatewayHealth = "unknown";
  try {
    const response = await fetch(`${config.sub2apiUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    gatewayHealth = response.ok ? "ok" : `http_${response.status}`;
  } catch {
    gatewayHealth = "unreachable";
  }

  let adminLogin = "not_configured";
  let group: GroupResponse | null = null;
  let modelCount = 0;
  if (isSub2ApiConfigured()) {
    try {
      await getAdminToken();
      adminLogin = "ok";
      group = await adminRequest<GroupResponse>(
        `/api/v1/admin/groups/${config.sub2apiGroupId}`,
      );
      const plaza = await adminRequest<ModelPlazaResponse>("/api/v1/model-plaza");
      modelCount = (plaza.groups || []).reduce(
        (sum, item) => sum + (item.models?.length || 0),
        0,
      );
    } catch (error) {
      adminLogin = error instanceof Error ? error.message : "failed";
    }
  }

  const ops = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
       FROM gateway_balance_ops
      WHERE status IN ('pending', 'failed', 'applying')
      GROUP BY status`,
  );
  const prices = await query<{ status: string; count: string }>(
    "SELECT status, COUNT(*)::text AS count FROM model_prices_current GROUP BY status",
  );
  const lastSync = await query<{
    started_at: string;
    finished_at: string | null;
    status: string;
    models_total: number;
    models_updated: number;
    models_paused: number;
  }>(
    `SELECT started_at, finished_at, status, models_total, models_updated, models_paused
       FROM pricing_sync_runs ORDER BY started_at DESC LIMIT 1`,
  );

  return Response.json(
    {
      ok: gatewayHealth === "ok" && adminLogin === "ok",
      gateway: {
        url: config.sub2apiUrl,
        health: gatewayHealth,
        admin_login: adminLogin,
        group,
        rate_multiplier: group?.rate_multiplier ?? null,
        model_count: modelCount,
      },
      credit_ops: Object.fromEntries(ops.rows.map((row) => [row.status, Number(row.count)])),
      prices: Object.fromEntries(prices.rows.map((row) => [row.status, Number(row.count)])),
      last_pricing_sync: lastSync.rows[0] || null,
      checked_at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
