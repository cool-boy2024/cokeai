import Stripe from "stripe";
import { config } from "./config";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }
  return stripeClient;
}

export async function createStripeCheckout(input: {
  orderId: string;
  userId: string;
  planId: string;
  planName: string;
  amountMicros: number;
  email: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const unitAmount = Math.round(input.amountMicros / 10_000);
  if (unitAmount <= 0) throw new Error("订单金额无效");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.email,
    client_reference_id: input.orderId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (process.env.STRIPE_CURRENCY || "cny").toLowerCase(),
          unit_amount: unitAmount,
          product_data: {
            name: `${config.appName} · ${input.planName}`,
            description: "AI API 用量额度与平台服务",
          },
        },
      },
    ],
    metadata: {
      orderId: input.orderId,
      userId: input.userId,
      planId: input.planId,
    },
    success_url: `${config.appUrl}/dashboard/billing?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/dashboard/billing?cancelled=1`,
    allow_promotion_codes: false,
  });

  if (!session.url) throw new Error("Stripe 未返回支付链接");
  return { url: session.url, sessionId: session.id };
}
