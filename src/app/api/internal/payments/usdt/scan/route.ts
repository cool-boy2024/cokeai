import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import { scanUsdtDeposits } from "@/lib/payments/usdt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  try {
    const result = await scanUsdtDeposits();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[usdt-scan]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "scan_failed" },
      { status: 500 },
    );
  }
}
