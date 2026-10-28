import { expireShopOrders, purgeDeliveredCustomerInputs } from "@/lib/shop/orders";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  const expired = await expireShopOrders();
  const purged = await purgeDeliveredCustomerInputs();
  return Response.json(
    { ok: true, expired, purged },
    { headers: { "Cache-Control": "no-store" } },
  );
}
