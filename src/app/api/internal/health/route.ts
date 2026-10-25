import { query, toNumber } from "@/lib/db";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { redisHealth } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  let dbOk = false;
  let counts = { enabledModels: 0, configuredUpstreams: 0 };
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
    counts = {
      enabledModels: toNumber(result.rows[0]?.enabled_models),
      configuredUpstreams: toNumber(result.rows[0]?.configured_upstreams),
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "db_error";
  }

  const redis = await redisHealth();
  const healthy = dbOk && counts.enabledModels > 0;
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      checked_at: new Date().toISOString(),
      database: dbOk ? "ok" : "unavailable",
      redis,
      enabled_models: counts.enabledModels,
      configured_upstreams: counts.configuredUpstreams,
      last_error: lastError,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
