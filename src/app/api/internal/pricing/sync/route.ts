import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { syncPricing } from "@/lib/pricing/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  let force = false;
  try {
    const body = (await request.json()) as { force?: boolean };
    force = Boolean(body?.force);
  } catch {
    // Empty body is fine.
  }

  try {
    const result = await syncPricing({ force });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[pricing-sync]", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "pricing_sync_failed",
      },
      { status: 500 },
    );
  }
}
