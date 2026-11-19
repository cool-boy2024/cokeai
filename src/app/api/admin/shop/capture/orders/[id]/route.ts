import { after } from "next/server";
import { adminFromCaptureToken, applyShopCapture, type CapturePayload } from "@/lib/shop/capture";
import { notifyShopOrderDelivered } from "@/lib/shop/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The helper posts the supplier-delivered CDK / account here. Body:
 * { kind: "code"|"account"|"manual_note", fields: Record<string,string>,
 *   supplierOrderRef?: string, pageUrl?: string }
 * Everything lands through deliverShopItem, so the payload is encrypted,
 * events are written and the customer is notified exactly like a manual
 * paste. Failures keep the order in procuring for the manual fallback.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const raw = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = raw ? await adminFromCaptureToken(raw) : null;
  if (!admin) {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await params;
  if (!UUID.test(id)) {
    return Response.json({ error: "invalid_order_id" }, { status: 400 });
  }

  let body: CapturePayload;
  try {
    body = (await request.json()) as CapturePayload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.fields !== "object" || !body.fields) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }
  if (
    typeof body.supplierOrderRef !== "undefined" &&
    typeof body.supplierOrderRef !== "string"
  ) {
    return Response.json({ error: "invalid_supplier_order_ref" }, { status: 400 });
  }
  if (typeof body.pageUrl !== "undefined" && typeof body.pageUrl !== "string") {
    return Response.json({ error: "invalid_page_url" }, { status: 400 });
  }

  try {
    const result = await applyShopCapture({ orderId: id, adminId: admin.id, payload: body });
    if (result.orderDelivered) {
      // Same customer notification as the manual paste path.
      after(async () => {
        await notifyShopOrderDelivered(id).catch((error) => {
          console.error("[shop] capture delivery notification failed", error);
        });
      });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Deliberately 409-ish plain message: the helper surfaces it to the
    // operator, who falls back to the manual paste box.
    return Response.json(
      { error: error instanceof Error ? error.message : "capture_failed" },
      { status: 409 },
    );
  }
}
