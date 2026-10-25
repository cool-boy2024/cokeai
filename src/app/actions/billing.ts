"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, toNumber } from "@/lib/db";
import { createStripeCheckout } from "@/lib/stripe";

export type BillingState = { error?: string };

export async function createCheckoutAction(
  _prev: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const user = await requireUser();
  const planId = String(formData.get("planId") || "");
  const provider = String(formData.get("provider") || "stripe");

  const planResult = await query<{
    id: string;
    name: string;
    price_micros: string;
    credits_micros: string;
    duration_days: number;
  }>(
    `SELECT id, name, price_micros, credits_micros, duration_days
       FROM plans
      WHERE id = $1 AND active = TRUE
      LIMIT 1`,
    [planId],
  );
  const plan = planResult.rows[0];
  if (!plan) return { error: "套餐不存在或已下架" };

  if (provider === "stripe" && !config.stripeEnabled) {
    return { error: "在线支付尚未配置，请使用人工支付。" };
  }
  if (provider === "manual" && !config.manualPaymentsEnabled) {
    return { error: "人工支付暂不可用。" };
  }
  if (provider !== "stripe" && provider !== "manual") {
    return { error: "支付方式无效。" };
  }

  const inserted = await query<{ id: string }>(
    `INSERT INTO orders
      (user_id, plan_id, amount_micros, credits_micros, duration_days, payment_provider)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      user.id,
      plan.id,
      plan.price_micros,
      plan.credits_micros,
      plan.duration_days,
      provider,
    ],
  );
  const orderId = inserted.rows[0].id;

  if (provider === "manual") {
    revalidatePath("/dashboard/billing");
    redirect(`/dashboard/billing?order=${orderId}&manual=1`);
  }

  let checkoutUrl: string;
  try {
    const session = await createStripeCheckout({
      orderId,
      userId: user.id,
      planId: plan.id,
      planName: plan.name,
      amountMicros: toNumber(plan.price_micros),
      email: user.email,
    });
    await query(
      `UPDATE orders
          SET provider_ref = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [orderId, session.sessionId],
    );
    checkoutUrl = session.url;
  } catch (error) {
    console.error("[checkout]", error);
    await query(
      "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'",
      [orderId],
    );
    revalidatePath("/dashboard/billing");
    return { error: "创建支付页面失败，请稍后重试。" };
  }

  revalidatePath("/dashboard/billing");
  redirect(checkoutUrl);
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") || "");
  if (!orderId) return;
  await query(
    `UPDATE orders
        SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'pending' AND provider_ref IS NULL`,
    [orderId, user.id],
  );
  revalidatePath("/dashboard/billing");
}
