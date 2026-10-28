import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { syncStaleGatewayBalances } from "@/lib/gateway-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  let limit = 50;
  try {
    const body = (await request.json()) as { limit?: number };
    if (Number.isFinite(body?.limit)) {
      limit = Math.min(200, Math.max(1, Math.trunc(body.limit as number)));
    }
  } catch {
    // Empty body uses the default.
  }

  try {
    const result = await syncStaleGatewayBalances(limit);
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[balance-sync]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "balance_sync_failed" },
      { status: 500 },
    );
  }
}
