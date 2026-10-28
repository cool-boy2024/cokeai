import { query, toNumber } from "@/lib/db";
import { parseEasyPayNotification } from "@/lib/payments/easypay";
import { markShopOrderPaid } from "@/lib/shop/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function payloadFrom(request: Request): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const result: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    result[key] = value;
  });
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        result[key] = String(value ?? "");
      }
    } else {
      const form = await request.formData().catch(() => null);
      if (form) {
        form.forEach((value, key) => {
          result[key] = String(value ?? "");
        });
      }
    }
  }
  return result;
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  const payload = await payloadFrom(request);
  const notification = parseEasyPayNotification(payload);
  if (!notification.valid) return text("fail", 400);
  if (notification.status !== "TRADE_SUCCESS") {
    await recordEvent(notification.orderId, notification.tradeNo, "ignored", null, payload);
    return text("success");
  }

  const orderResult = await query<{
    id: string;
    status: string;
    amount_micros: string | number;
    payment_provider: string;
  }>(
    `SELECT id, status, amount_micros, payment_provider
       FROM shop_orders WHERE order_no = $1 LIMIT 1`,
    [notification.orderId],
  );
  const order = orderResult.rows[0];
  if (!order) {
    await recordEvent(notification.orderId, notification.tradeNo, "failed", "order_not_found", payload);
    return text("success");
  }
  if (order.payment_provider !== "alipay_easypay") {
    await recordEvent(notification.orderId, notification.tradeNo, "failed", "provider_mismatch", payload);
    return text("success");
  }

  const paidMicros = Math.round(notification.amount * 1_000_000);
  if (Math.abs(toNumber(order.amount_micros) - paidMicros) > 10_000) {
    await recordEvent(notification.orderId, notification.tradeNo, "failed", "amount_mismatch", payload);
    return text("success");
  }

  const eventId = `${notification.orderId}:${notification.tradeNo}`;
  const claimed = await query<{ id: string; status: string }>(
    `INSERT INTO shop_payment_events (provider, event_id, order_id, status, payload)
     VALUES ('easypay', $1, $2, 'received', $3)
     ON CONFLICT (provider, event_id) DO UPDATE SET payload = EXCLUDED.payload
     RETURNING id, status`,
    [eventId, order.id, JSON.stringify(payload)],
  );
  if (claimed.rows[0]?.status === "processed") {
    return text("success");
  }

  try {
    await markShopOrderPaid({
      orderNo: notification.orderId,
      provider: "alipay_easypay",
      providerRef: notification.tradeNo,
      paidAmountMicros: paidMicros,
    });
    await query(
      `UPDATE shop_payment_events
          SET status = 'processed', processed_at = now(), error = NULL
        WHERE provider = 'easypay' AND event_id = $1`,
      [eventId],
    );
    return text("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "payment_failed";
    await query(
      `UPDATE shop_payment_events
          SET status = 'failed', processed_at = now(), error = $2
        WHERE provider = 'easypay' AND event_id = $1`,
      [eventId, message.slice(0, 500)],
    );
    // EasyPay retries non-"success" responses. A closed order will never become
    // payable, so acknowledge it and leave the failure for an operator.
    if (message === "ORDER_CLOSED") return text("success");
    return text("fail", 500);
  }
}

async function recordEvent(
  orderNo: string,
  tradeNo: string,
  status: "ignored" | "failed",
  error: string | null,
  payload: Record<string, string>,
): Promise<void> {
  const orderResult = await query<{ id: string }>(
    "SELECT id FROM shop_orders WHERE order_no = $1 LIMIT 1",
    [orderNo],
  );
  const orderId = orderResult.rows[0]?.id || null;
  const eventId = `${orderNo}:${tradeNo || "unknown"}`;
  await query(
    `INSERT INTO shop_payment_events
       (provider, event_id, order_id, status, error, payload, processed_at)
     VALUES ('easypay', $1, $2, $3, $4, $5, now())
     ON CONFLICT (provider, event_id) DO UPDATE SET
       status = EXCLUDED.status, error = EXCLUDED.error,
       payload = EXCLUDED.payload, processed_at = now()`,
    [eventId, orderId, status, error, JSON.stringify(payload)],
  );
}
