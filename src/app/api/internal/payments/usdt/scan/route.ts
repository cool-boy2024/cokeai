import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import {
  expireUnpaidUsdtOrders,
  scanUsdtDeposits,
} from "@/lib/payments/usdt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  try {
    // Scan first: a transfer observed before the deadline must be recorded
    // before the fallback cleanup considers an order unpaid.
    const result = await scanUsdtDeposits();
    const expired = await expireUnpaidUsdtOrders();
    return Response.json({ ok: true, ...result, expired });
  } catch (error) {
    console.error("[usdt-scan]", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "scan_failed" },
      { status: 500 },
    );
  }
}
