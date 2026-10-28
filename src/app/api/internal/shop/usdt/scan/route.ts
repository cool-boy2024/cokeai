import { scanShopUsdtDeposits } from "@/lib/shop/usdt";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  const result = await scanShopUsdtDeposits();
  return Response.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
