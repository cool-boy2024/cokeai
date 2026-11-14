import { syncShopFeed } from "@/lib/shop/sync";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const result = await syncShopFeed();
    return Response.json(
      { ok: result.status !== "failed", ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Keep supplier hosts and upstream wording out of the HTTP response; the
    // details stay in server logs for operators.
    console.error("[internal/shop/sync]", error);
    return Response.json(
      { ok: false, error: "shop_sync_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
