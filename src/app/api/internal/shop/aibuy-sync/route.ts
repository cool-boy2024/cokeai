import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { syncAibuyProducts } from "@/lib/shop/zyanai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled mirror of the ai-buy.vip catalogue. Same storefront software as
 * zyanai, so the parsing and scrubbing live in one adapter. Fulfilment stays
 * manual; this only refreshes titles, copy, prices and stock state from the
 * supplier's public pages. Triggered by n8n, or manually:
 *   POST /api/internal/shop/aibuy-sync?dry=1&limit=5
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
    const result = await syncAibuyProducts({ dryRun, limit });
    const ok = result.skipped.length === 0;
    return Response.json(
      { ok, ...result },
      {
        status: ok ? 200 : 207,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("[internal/shop/aibuy-sync]", error);
    return Response.json(
      { ok: false, error: "aibuy_sync_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
