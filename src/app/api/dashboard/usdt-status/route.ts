import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const orderId = new URL(request.url).searchParams.get("orderId") || "";
  if (!orderId) return Response.json({ error: "orderId_required" }, { status: 400 });

  const result = await query<{
    order_status: string;
    pay_amount: string | null;
    deposit_status: string | null;
    received_usdt: string | null;
    confirmations: number | null;
    expires_at: string | null;
    txid: string | null;
  }>(
    `SELECT o.status AS order_status, o.pay_amount,
            d.status AS deposit_status, d.received_usdt, d.confirmations,
            d.expires_at, d.txid
       FROM orders o
       LEFT JOIN usdt_deposits d ON d.order_id = o.id
      WHERE o.id = $1 AND o.user_id = $2
      LIMIT 1`,
    [orderId, user.id],
  );

  const row = result.rows[0];
  if (!row) return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json(
    {
      orderStatus: row.order_status,
      payAmount: row.pay_amount ? Number(row.pay_amount) : null,
      depositStatus: row.deposit_status,
      receivedUsdt: row.received_usdt ? Number(row.received_usdt) : 0,
      confirmations: row.confirmations ?? 0,
      expiresAt: row.expires_at,
      txid: row.txid,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
