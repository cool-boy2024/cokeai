"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import { getManualAlipaySettings } from "@/lib/payments/settings";
import { buildEasyPayCheckout, easyPayConfigError } from "@/lib/payments/easypay";
import { createUsdtDeposit, isUsdtConfigured } from "@/lib/payments/usdt";
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
  if (!plan) return { error: "充值包不存在或已下架" };

  if (provider === "stripe" && !config.stripeEnabled) {
    return { error: "在线支付尚未配置，请使用其他方式。" };
  }
  if (provider === "manual" && !config.manualPaymentsEnabled) {
    return { error: "人工支付暂不可用。" };
  }
  if (provider === "easypay") {
    const error = easyPayConfigError();
    if (error) return { error };
  }
  if (provider === "usdt" && !(await isUsdtConfigured())) {
    return { error: "USDT 支付尚未配置。" };
  }
  if (!["stripe", "manual", "alipay_manual", "easypay", "usdt"].includes(provider)) {
    return { error: "支付方式无效。" };
  }

  if (provider === "alipay_manual") {
    const settings = await getManualAlipaySettings();
    if (!settings.enabled || !settings.qrDataUrl || !settings.payee) return { error: "支付宝收款暂未开放" };
    const id = await withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO orders (user_id, plan_id, amount_micros, credits_micros, duration_days, payment_provider)
         VALUES ($1,$2,$3,$4,$5,'alipay_manual') RETURNING id`,
        [user.id, plan.id, plan.price_micros, plan.credits_micros, plan.duration_days],
      );
      const orderId = result.rows[0].id;
      await client.query("INSERT INTO manual_alipay_payments (order_id, qr_data_url, payee) VALUES ($1,$2,$3)", [orderId, settings.qrDataUrl, settings.payee]);
      return orderId;
    });
    revalidatePath("/dashboard/billing");
    redirect(`/dashboard/billing/alipay/${id}`);
  }

  const paymentProvider = provider === "easypay" ? "alipay_easypay" : provider === "usdt" ? "usdt_trc20" : provider;
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
      paymentProvider,
    ],
  );
  const orderId = inserted.rows[0].id;

  if (provider === "manual") {
    revalidatePath("/dashboard/billing");
    redirect(`/dashboard/billing?order=${orderId}&manual=1`);
  }

  if (provider === "easypay") {
    let checkoutUrl: string;
    try {
      const checkout = buildEasyPayCheckout({
        orderId,
        amountYuan: toNumber(plan.price_micros) / 1_000_000,
        productName: `${config.appName} ${plan.name}`,
      });
      // provider_ref prevents a local cancel while the payment page is live.
      await query(
        "UPDATE orders SET provider_ref = $2, updated_at = now() WHERE id = $1",
        [orderId, `easypay:${orderId}`],
      );
      checkoutUrl = checkout.url;
    } catch (error) {
      console.error("[easypay-checkout]", error);
      await query(
        "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'",
        [orderId],
      );
      revalidatePath("/dashboard/billing");
      return { error: "创建支付宝支付失败，请稍后重试。" };
    }
    revalidatePath("/dashboard/billing");
    redirect(checkoutUrl);
  }

  if (provider === "usdt") {
    try {
      await createUsdtDeposit({
        orderId,
        amountYuan: toNumber(plan.price_micros) / 1_000_000,
      });
    } catch (error) {
      console.error("[usdt-checkout]", error);
      await query(
        "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'",
        [orderId],
      );
      revalidatePath("/dashboard/billing");
      return { error: error instanceof Error ? error.message : "创建 USDT 订单失败。" };
    }
    revalidatePath("/dashboard/billing");
    redirect(`/dashboard/billing/usdt/${orderId}`);
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
      WHERE id = $1
        AND user_id = $2
        AND status = 'pending'
        AND payment_provider IN ('manual', 'usdt_trc20')
        AND pay_txid IS NULL
        AND (
          payment_provider <> 'usdt_trc20'
          OR NOT EXISTS (
            SELECT 1
              FROM usdt_deposits d
             WHERE d.order_id = orders.id
               AND (
                 d.received_usdt > 0
                 OR d.status IN ('confirming', 'confirmed', 'overpaid', 'manual')
               )
          )
        )`,
    [orderId, user.id],
  );
  revalidatePath("/dashboard/billing");
}
