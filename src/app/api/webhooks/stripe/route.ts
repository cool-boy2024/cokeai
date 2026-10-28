import { fulfillOrder } from "@/lib/orders";
import { getStripe } from "@/lib/stripe";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    console.warn("[stripe-webhook] signature verification failed", error);
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      if (orderId && session.payment_status === "paid") {
        const fulfilled = await fulfillOrder(orderId);
        // Ask Stripe to retry when the gateway top-up did not land yet.
        if (fulfilled.creditStatus === "failed") {
          throw new Error("gateway_credit_failed");
        }
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      await query(
        `UPDATE orders
            SET status = 'cancelled', updated_at = now()
          WHERE provider_ref = $1
            AND status = 'pending'`,
        [session.id],
      );
    }
  } catch (error) {
    console.error("[stripe-webhook]", error);
    return Response.json({ error: "webhook_processing_failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
