import { getCurrentUser } from "@/lib/auth";
import { expireShopUsdtOrderForUser } from "@/lib/shop/usdt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { orderId?: unknown }
    | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  if (!orderId) return Response.json({ error: "orderId_required" }, { status: 400 });

  try {
    const expired = await expireShopUsdtOrderForUser(orderId, user.id);
    return Response.json(
      { ok: true, expired },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[shop-usdt-expire] route failed",
      orderId,
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: false, expired: false }, { status: 500 });
  }
}
