import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tiny status endpoint for the sources page watcher. Polling this is much
 * cheaper than re-rendering the 1000-row table every few seconds.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    // Do not reveal that this admin endpoint exists. Non-admins get the same
    // 404 they would for any unknown path.
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (jobId && !UUID.test(jobId)) {
    return Response.json({ error: "invalid_job_id" }, { status: 400 });
  }

  const pendingResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM shop_import_jobs
      WHERE status IN ('queued', 'running')`,
  );

  let job: {
    status: string;
    productId: string | null;
    error: string | null;
  } | null = null;

  if (jobId) {
    const jobResult = await query<{
      status: string;
      product_id: string | null;
      error: string | null;
    }>(
      `SELECT status, product_id, error
         FROM shop_import_jobs
        WHERE id = $1
        LIMIT 1`,
      [jobId],
    );
    const row = jobResult.rows[0];
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    job = {
      status: row.status,
      productId: row.product_id,
      error: row.error,
    };
  }

  return Response.json(
    { pending: Number(pendingResult.rows[0]?.count || 0), job },
    { headers: { "Cache-Control": "no-store" } },
  );
}
