import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { retryPendingCreditOps } from "@/lib/gateway-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  try {
    const result = await retryPendingCreditOps();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[credits-retry]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "retry_failed" },
      { status: 500 },
    );
  }
}
