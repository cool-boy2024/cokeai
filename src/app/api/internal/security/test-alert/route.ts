import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { sendSecurityTestAlert } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-only channel test. Uses the same encrypted channel configured at
 * /admin/security/alerts and the same 30s cooldown as the admin button.
 * Protected by INTERNAL_API_SECRET so it can be called from the server without
 * creating an admin session.
 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  const result = await sendSecurityTestAlert();
  return Response.json(
    { ok: result.ok, error: result.error ?? null },
    {
      status: result.ok ? 200 : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
