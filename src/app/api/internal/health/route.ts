import { config } from "@/lib/config";
import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { redisHealth } from "@/lib/rate-limit";
import { adminRequest, getAdminToken } from "@/lib/sub2api/auth";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupResponse = {
  id: number;
  name: string;
  platform: string;
  status?: string;
  rate_multiplier?: number;
  model_allowlist?: { enabled?: boolean; models?: string[] };
};

type PlazaResponse = {
  groups?: Array<{ id: number; models?: unknown[] }>;
};

type SupplierRow = {
  name: string;
  kind: string;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
};

/**
 * A scheduled sync that silently stops is worse than one that fails loudly:
 * stock and prices keep looking current. The health probe compares each
 * enabled supplier against its expected cadence (aibijia hourly, zyanai every
 * six hours) so the existing 15-minute alert surfaces a stalled schedule even
 * if n8n swallowed the request error.
 */
const SUPPLIER_STALE_AFTER_MS: Record<string, number> = {
  aibijia: 6 * 60 * 60 * 1000,
  zyanai: 24 * 60 * 60 * 1000,
};

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  let dbOk = false;
  let legacy = { enabledModels: 0, configuredUpstreams: 0 };
  let lastError: string | null = null;
  try {
    await query("SELECT 1");
    dbOk = true;
    const result = await query<{ enabled_models: string; configured_upstreams: string }>(
      `SELECT
        (SELECT COUNT(*) FROM models m JOIN upstreams u ON u.id = m.upstream_id
          WHERE m.enabled = TRUE AND u.enabled = TRUE AND u.api_key_encrypted IS NOT NULL) AS enabled_models,
        (SELECT COUNT(*) FROM upstreams WHERE enabled = TRUE AND api_key_encrypted IS NOT NULL) AS configured_upstreams`,
    );
    legacy = {
      enabledModels: toNumber(result.rows[0]?.enabled_models),
      configuredUpstreams: toNumber(result.rows[0]?.configured_upstreams),
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "db_error";
  }

  const redis = await redisHealth();
  const configured = isSub2ApiConfigured();
  const gateway = {
    configured,
    health: "not_configured",
    admin_login: "not_configured",
    group_name: null as string | null,
    group_status: null as string | null,
    rate_multiplier: null as number | null,
    model_count: 0,
    error: null as string | null,
  };

  if (configured) {
    try {
      const response = await fetch(`${config.sub2apiUrl}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      gateway.health = response.ok ? "ok" : `http_${response.status}`;
    } catch {
      gateway.health = "unreachable";
    }

    try {
      await getAdminToken();
      gateway.admin_login = "ok";

      const group = await adminRequest<GroupResponse>(
        `/api/v1/admin/groups/${config.sub2apiGroupId}`,
      );
      gateway.group_name = group.name;
      gateway.group_status = group.status || null;
      gateway.rate_multiplier =
        group.rate_multiplier === undefined ? null : Number(group.rate_multiplier);
      if (group.model_allowlist?.enabled) {
        gateway.model_count = group.model_allowlist.models?.length || 0;
      } else {
        const plaza = await adminRequest<PlazaResponse>("/api/v1/model-plaza");
        const plazaGroup = (plaza.groups || []).find(
          (item) => item.id === config.sub2apiGroupId,
        );
        gateway.model_count = plazaGroup?.models?.length || 0;
      }
    } catch (error) {
      gateway.admin_login = "failed";
      gateway.error = error instanceof Error ? error.message : "gateway_error";
    }
  }

  const gatewayOk = configured
    ? gateway.health === "ok" &&
      gateway.admin_login === "ok" &&
      gateway.model_count > 0 &&
      (gateway.rate_multiplier === null || gateway.rate_multiplier === 1)
    : legacy.enabledModels > 0;

  let suppliers: Array<{
    name: string;
    kind: string;
    last_success_at: string | null;
    stale: boolean;
  }> = [];
  const staleSuppliers: string[] = [];
  try {
    const rows = await query<SupplierRow>(
      `SELECT name, kind, last_success_at, last_error, created_at
         FROM shop_suppliers
        WHERE enabled = TRUE
        ORDER BY name`,
    );
    const now = Date.now();
    suppliers = rows.rows.map((row) => {
      const budget = SUPPLIER_STALE_AFTER_MS[row.kind];
      const last = Date.parse(row.last_success_at || row.created_at);
      const stale = Boolean(budget) && Number.isFinite(last) && now - last > budget;
      if (stale) staleSuppliers.push(row.name);
      return {
        name: row.name,
        kind: row.kind,
        last_success_at: row.last_success_at,
        stale,
      };
    });
  } catch (error) {
    // A failed probe must not crash the health endpoint; the DB check above
    // already reports database availability.
    console.warn("[internal/health] supplier staleness check failed:", error);
  }
  const suppliersOk = staleSuppliers.length === 0;

  const healthy = dbOk && redis === "ok" && gatewayOk && suppliersOk;
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      checked_at: new Date().toISOString(),
      database: dbOk ? "ok" : "unavailable",
      redis,
      // Kept for old alert templates. With Sub2API configured these reflect
      // the gateway's sellable model count, not the legacy local table.
      enabled_models: configured ? gateway.model_count : legacy.enabledModels,
      configured_upstreams: configured ? 1 : legacy.configuredUpstreams,
      gateway,
      suppliers,
      last_error:
        lastError ||
        gateway.error ||
        (suppliersOk
          ? null
          : `货源同步停滞：${staleSuppliers.join("、")}（已超过计划同步周期）`),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
