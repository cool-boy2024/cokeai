import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import {
  reconcilePendingKeyProvisions,
  retryPendingKeyRevocations,
} from "@/lib/sub2api/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const [revocations, provisions] = await Promise.all([
      retryPendingKeyRevocations(),
      reconcilePendingKeyProvisions(),
    ]);
    return Response.json(
      { ok: true, revocations, provisions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[keys-retry]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "keys_retry_failed" },
      { status: 500 },
    );
  }
}
