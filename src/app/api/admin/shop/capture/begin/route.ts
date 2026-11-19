import { getCurrentUser } from "@/lib/auth";
import { beginShopCapture } from "@/lib/shop/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Queue-page button: marks the order as waiting for the capture helper
 * (capture_pending_until = now + 30min, status -> procuring) and returns the
 * supplier URL so the client can open it in one click. Gated by
 * SHOP_CAPTURE_MIN_QUEUE; below the threshold the operator keeps the manual
 * flow and gets a plain message.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("x-cokeai-capture") !== "1") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  let body: { orderId?: unknown };
  try {
    body = (await request.json()) as { orderId?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!UUID.test(orderId)) {
    return Response.json({ error: "invalid_order_id" }, { status: 400 });
  }
  try {
    const result = await beginShopCapture({ orderId, adminId: user.id });
    return Response.json({ ...result, captureEnabled: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "begin_failed", captureEnabled: false },
      { status: 409 },
    );
  }
}
