import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { matureCommissions } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  try {
    const matured = await matureCommissions();
    return Response.json({ ok: true, matured });
  } catch (error) {
    console.error("[commissions-mature]", error);
    return Response.json({ error: "mature_failed" }, { status: 500 });
  }
}
