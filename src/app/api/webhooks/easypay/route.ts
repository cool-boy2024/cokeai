import { fulfillOrder } from "@/lib/orders";
import { query } from "@/lib/db";
import {
  EASYPAY_KEY_MISSING_MESSAGE,
  isEasyPayConfigured,
  parseEasyPayNotification,
} from "@/lib/payments/easypay";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function success(): Response {
  return new Response("success", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function readPayload(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, String(value ?? "")]),
    );
  }
  const form = await request.formData();
  const payload: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    payload[key] = typeof value === "string" ? value : "";
  }
  return payload;
}

export async function POST(request: Request): Promise<Response> {
  if (!isEasyPayConfigured()) {
    if (config.easypayEnabled && !config.easypayKey) {
      console.error("[easypay] webhook rejected:", EASYPAY_KEY_MISSING_MESSAGE);
      return Response.json(
        { error: "easypay_key_missing", message: EASYPAY_KEY_MISSING_MESSAGE },
        { status: 503 },
      );
    }
    return Response.json({ error: "easypay_not_configured" }, { status: 503 });
  }

  const payload = await readPayload(request);
  const event = parseEasyPayNotification(payload);
  if (!event.valid) {
    console.warn("[easypay] invalid notification", event.orderId, event.error);
    return Response.json({ error: event.error || "invalid_signature" }, { status: 400 });
  }

  const eventId = event.tradeNo;
  const inserted = await query<{ id: string }>(
    `INSERT INTO payment_events (provider, event_id, order_id, status, payload)
     VALUES (
       'easypay',
       $1,
       (SELECT id FROM orders WHERE id::text = $2 LIMIT 1),
       'received',
       $3::jsonb
     )
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [eventId, event.orderId, JSON.stringify(event.raw)],
  );

  if (!inserted.rows[0]) {
    const existing = await query<{ status: string }>(
      "SELECT status FROM payment_events WHERE provider = 'easypay' AND event_id = $1",
      [eventId],
    );
    if (existing.rows[0]?.status === "processed") return success();
  }

  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(event.status)) {
    await query(
      `UPDATE payment_events
          SET status = 'ignored', processed_at = now()
        WHERE provider = 'easypay' AND event_id = $1`,
      [eventId],
    );
    return success();
  }

  try {
    const orderResult = await query<{
      id: string;
      amount_micros: string;
      status: string;
      payment_provider: string;
    }>(
      "SELECT id, amount_micros, status, payment_provider FROM orders WHERE id::text = $1 LIMIT 1",
      [event.orderId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      await query(
        `UPDATE payment_events
            SET status = 'failed', error = 'order_not_found', processed_at = now()
          WHERE provider = 'easypay' AND event_id = $1`,
        [eventId],
      );
      return Response.json({ error: "order_not_found" }, { status: 404 });
    }

    if (order.payment_provider !== "alipay_easypay") {
      await query(
        `UPDATE payment_events
            SET status = 'failed', error = 'provider_mismatch', processed_at = now()
          WHERE provider = 'easypay' AND event_id = $1`,
        [eventId],
      );
      return Response.json({ error: "provider_mismatch" }, { status: 400 });
    }

    // Compare in cents to avoid binary floating point drift.
    const expectedCents = Math.round(Number(order.amount_micros) / 10_000);
    const paidCents = Math.round(event.amount * 100);
    if (paidCents !== expectedCents) {
      await query(
        `UPDATE payment_events
            SET status = 'failed', error = 'amount_mismatch', processed_at = now()
          WHERE provider = 'easypay' AND event_id = $1`,
        [eventId],
      );
      return Response.json({ error: "amount_mismatch" }, { status: 400 });
    }

    if (order.status === "paid") {
      // Duplicate notification for an order already marked paid. Retry the
      // outbox row: a previous attempt may have failed after the order was
      // committed. fulfillOrder is idempotent and reuses the same reference.
      const fulfilled = await fulfillOrder(order.id);
      if (fulfilled.creditStatus === "failed") {
        await query(
          `UPDATE payment_events
              SET status = 'failed', error = 'gateway_credit_failed', processed_at = now()
            WHERE provider = 'easypay' AND event_id = $1`,
          [eventId],
        );
        return Response.json({ error: "gateway_credit_failed" }, { status: 500 });
      }
      await query(
        `UPDATE payment_events
            SET status = 'processed', processed_at = now()
          WHERE provider = 'easypay' AND event_id = $1`,
        [eventId],
      );
      return success();
    }

    if (order.status !== "pending") {
      // Money arrived for a cancelled/refunded order. Record it for manual
      // reconciliation and acknowledge so the provider stops retrying.
      console.error(
        "[easypay] paid notification for non-pending order",
        order.id,
        order.status,
      );
      await query(
        `UPDATE payment_events
            SET status = 'failed', error = 'order_not_pending', processed_at = now()
          WHERE provider = 'easypay' AND event_id = $1`,
        [eventId],
      );
      return success();
    }

    await query(
      `UPDATE orders
          SET provider_ref = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [order.id, event.tradeNo],
    );

    const fulfilled = await fulfillOrder(order.id);
    if (fulfilled.creditStatus === "failed") {
      await query(
        `UPDATE payment_events
            SET status = 'failed', error = 'gateway_credit_failed', processed_at = now()
          WHERE provider = 'easypay' AND event_id = $1`,
        [eventId],
      );
      // Returning a non-2xx asks EasyPay to retry the notification.
      return Response.json({ error: "gateway_credit_failed" }, { status: 500 });
    }

    await query(
      `UPDATE payment_events
          SET status = 'processed', processed_at = now()
        WHERE provider = 'easypay' AND event_id = $1`,
      [eventId],
    );
    return success();
  } catch (error) {
    console.error("[easypay] processing failed", error);
    await query(
      `UPDATE payment_events
          SET status = 'failed', error = $2, processed_at = now()
        WHERE provider = 'easypay' AND event_id = $1`,
      [eventId, error instanceof Error ? error.message.slice(0, 500) : "unknown"],
    );
    return Response.json({ error: "webhook_processing_failed" }, { status: 500 });
  }
}
