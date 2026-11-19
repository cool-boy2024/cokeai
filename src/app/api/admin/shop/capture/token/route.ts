import { getCurrentUser } from "@/lib/auth";
import { issueCaptureToken } from "@/lib/shop/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a short-lived bearer token for the procurement Chrome helper. Called
 * same-origin from the admin console; the helper itself cannot send the admin
 * session cookie from chrome-extension://. Only one live token per admin.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("x-cokeai-capture") !== "1") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const issued = await issueCaptureToken(user.id);
  return Response.json(issued, { headers: { "Cache-Control": "no-store" } });
}
