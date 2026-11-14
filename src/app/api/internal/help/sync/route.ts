import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { syncHelpArticles } from "@/lib/help/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const result = await syncHelpArticles();
    return Response.json(result, {
      status: result.ok ? 200 : 207,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[internal/help/sync]", error);
    return Response.json(
      { ok: false, error: "help_sync_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
