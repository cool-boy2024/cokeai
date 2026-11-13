import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { syncZyanaiProducts } from "@/lib/shop/zyanai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled mirror of the zyanai catalogue. Fulfilment stays manual; this only
 * refreshes titles, copy, prices and stock state from the supplier's public
 * pages. Triggered by n8n every 6 hours, or manually:
 *   POST /api/internal/shop/zyanai-sync?dry=1&limit=5
 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return Response.json(
      { ok: false, error: "limit 需要正整数" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await syncZyanaiProducts({ dryRun, limit });
    const ok = result.skipped.length === 0;
    return Response.json(
      { ok, ...result },
      {
        status: ok ? 200 : 207,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "zyanai_sync_failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
