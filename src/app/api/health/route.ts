import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await query("SELECT 1");
    return Response.json(
      { status: "ok", service: "cokeai", time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unhealthy" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
