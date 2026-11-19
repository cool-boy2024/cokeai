import { getCurrentUser } from "@/lib/auth";
import { captureGate } from "@/lib/shop/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Queue-page helper: reports whether the procurement capture extension may
 * take over (pending orders >= SHOP_CAPTURE_MIN_QUEUE). Same 404 pattern as
 * the other admin endpoints so the path is not enumerable.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("x-cokeai-capture") !== "1") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const gate = await captureGate();
  return Response.json(gate, { headers: { "Cache-Control": "no-store" } });
}
