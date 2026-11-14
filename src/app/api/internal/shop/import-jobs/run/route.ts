import { runImportJob, runQueuedJobs } from "@/lib/shop/import";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Worker endpoint for queued "AI 上架" jobs.
 *
 * - n8n calls it on a schedule with an empty body to drain the queue.
 * - The admin button calls it with `{ jobId }` when n8n owns the run.
 *
 * Jobs only ever produce draft products; publishing stays manual.
 */
export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let jobId: string | null = null;
  let limit = 2;
  try {
    const body = (await request.json()) as { jobId?: unknown; limit?: unknown };
    if (body?.jobId !== undefined) {
      if (typeof body.jobId !== "string" || !UUID.test(body.jobId)) {
        return Response.json(
          { ok: false, error: "invalid_job_id" },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      jobId = body.jobId;
    }
    if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.min(Math.max(Math.trunc(body.limit), 1), 5);
    }
  } catch {
    // Empty body means "drain the queue".
  }

  try {
    const results = jobId ? [await runImportJob(jobId)] : await runQueuedJobs(limit);
    return Response.json(
      { ok: true, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal/shop/import-jobs/run]", error);
    return Response.json(
      { ok: false, error: "shop_import_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
