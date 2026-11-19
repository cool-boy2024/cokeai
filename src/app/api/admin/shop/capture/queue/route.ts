import { adminFromCaptureToken, listCaptureQueue } from "@/lib/shop/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Procurement Chrome helper polls this for orders waiting to be captured.
 * Auth is the bearer token minted from the admin console, not the session
 * cookie, because the helper's service worker cannot send cookies.
 */
export async function GET(request: Request): Promise<Response> {
  const raw = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = raw ? await adminFromCaptureToken(raw) : null;
  if (!admin) {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const items = await listCaptureQueue();
  return Response.json(
    { items, admin: admin.email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
