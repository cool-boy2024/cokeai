"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import { getManualAlipaySettings } from "@/lib/payments/settings";
import { buildEasyPayCheckout, easyPayConfigError } from "@/lib/payments/easypay";
import { networkForProvider } from "@/lib/payments/networks";
import { createUsdtDeposit, isUsdtNetworkConfigured } from "@/lib/payments/usdt";
import {
  CUSTOM_RECHARGE_PLAN_ID,
  customRechargeError,
  parseCustomRechargeMicros,
} from "@/lib/recharge";
import { createStripeCheckout } from "@/lib/stripe";

export type BillingState = { error?: string };

export async function createCheckoutAction(
  _prev: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const user = await requireUser();
  const planId = String(formData.get("planId") || "");
  // Older pages posted the single value "usdt"; treat it as TRC20.
  const postedProvider = String(formData.get("provider") || "stripe");
  const provider = postedProvider === "usdt" ? "usdt_trc20" : postedProvider;
  const usdtNetwork = networkForProvider(provider);

  // Where the user returns after a manual/bank order: recharge history lives
  // on the billing page, membership orders on the membership page.
  const returnPath =
    String(formData.get("flow") || "") === "membership"
      ? "/dashboard/membership"
      : "/dashboard/billing";

  const planResult = await query<{
    id: string;
    name: string;
    price_micros: string;
    credits_micros: string;
    duration_days: number;
    kind: string;
  }>(
    `SELECT id, name, price_micros, credits_micros, duration_days, kind
       FROM plans
      WHERE id = $1 AND active = TRUE
      LIMIT 1`,
    [planId],
  );
  const plan = planResult.rows[0];
  if (!plan) return { error: "充值包不存在或已下架" };

  // "custom" is a hidden placeholder row: the amount comes from the form and
  // is validated here, never trusted from the browser. The user tops up a
  // balance, so one yuan buys one yuan of balance.
  let amountMicros = toNumber(plan.price_micros);
  let creditsMicros = toNumber(plan.credits_micros);
  if (plan.id === CUSTOM_RECHARGE_PLAN_ID) {
    const parsed = parseCustomRechargeMicros(String(formData.get("amountYuan") || ""));
    if (parsed === null) return { error: customRechargeError() };
    amountMicros = parsed;
    creditsMicros = parsed;
  } else if (plan.kind === "membership") {
    // Membership is paid access to member pricing, not a balance top-up.
    creditsMicros = 0;
    if (amountMicros <= 0) return { error: "会员价格尚未配置，请联系客服。" };
  }

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
  if (usdtNetwork && !(await isUsdtNetworkConfigured(usdtNetwork))) {
    return { error: "USDT 支付尚未配置。" };
  }
  if (
    !["stripe", "manual", "alipay_manual", "easypay"].includes(provider) &&
    !usdtNetwork
  ) {
    return { error: "支付方式无效。" };
  }

  if (provider === "alipay_manual") {
    const settings = await getManualAlipaySettings();
    if (!settings.enabled || !settings.qrDataUrl || !settings.payee) return { error: "支付宝收款暂未开放" };
    const id = await withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO orders (user_id, plan_id, amount_micros, credits_micros, duration_days, payment_provider)
         VALUES ($1,$2,$3,$4,$5,'alipay_manual') RETURNING id`,
        [user.id, plan.id, amountMicros, creditsMicros, plan.duration_days],
      );
      const orderId = result.rows[0].id;
      await client.query("INSERT INTO manual_alipay_payments (order_id, qr_data_url, payee) VALUES ($1,$2,$3)", [orderId, settings.qrDataUrl, settings.payee]);
      return orderId;
    });
    revalidatePath(returnPath);
    redirect(`/dashboard/billing/alipay/${id}?flow=${plan.kind === "membership" ? "membership" : "billing"}`);
  }

  const paymentProvider = provider === "easypay" ? "alipay_easypay" : provider;
  const inserted = await query<{ id: string }>(
    `INSERT INTO orders
      (user_id, plan_id, amount_micros, credits_micros, duration_days, payment_provider)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      user.id,
      plan.id,
      amountMicros,
      creditsMicros,
      plan.duration_days,
      paymentProvider,
    ],
  );
  const orderId = inserted.rows[0].id;

  if (provider === "manual") {
    revalidatePath(returnPath);
    redirect(`${returnPath}?order=${orderId}&manual=1`);
  }

  if (provider === "easypay") {
    let checkoutUrl: string;
    try {
      const checkout = buildEasyPayCheckout({
        orderId,
        amountYuan: amountMicros / 1_000_000,
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
      revalidatePath(returnPath);
      return { error: "创建支付宝支付失败，请稍后重试。" };
    }
    revalidatePath(returnPath);
    redirect(checkoutUrl);
  }

  if (usdtNetwork) {
    try {
      await createUsdtDeposit({
        orderId,
        amountYuan: amountMicros / 1_000_000,
        network: usdtNetwork,
      });
    } catch (error) {
      console.error("[usdt-checkout]", error);
      await query(
        "UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'",
        [orderId],
      );
      revalidatePath(returnPath);
      return { error: error instanceof Error ? error.message : "创建 USDT 订单失败。" };
    }
    revalidatePath(returnPath);
    redirect(
      `/dashboard/billing/usdt/${orderId}?flow=${plan.kind === "membership" ? "membership" : "billing"}`,
    );
  }

  let checkoutUrl: string;
  try {
    const session = await createStripeCheckout({
      orderId,
      userId: user.id,
      planId: plan.id,
      planName: plan.name,
      amountMicros,
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
    revalidatePath(returnPath);
    return { error: "创建支付页面失败，请稍后重试。" };
  }

  revalidatePath(returnPath);
  redirect(checkoutUrl);
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") || "");
  if (!orderId) return;
  const returnPath =
    String(formData.get("returnTo") || "") === "/dashboard/membership"
      ? "/dashboard/membership"
      : "/dashboard/billing";

  const result = await query(
    `UPDATE orders o
        SET status = 'cancelled', updated_at = now()
      WHERE o.id = $1
        AND o.user_id = $2
        AND o.status = 'pending'
        -- Alipay (personal QR and EasyPay) orders are cancellable too; both
        -- flows can leave a pending order the buyer never pays.
        AND o.payment_provider IN (
          'manual', 'alipay_manual', 'alipay_easypay',
          'usdt_trc20', 'usdt_bsc', 'usdt_polygon'
        )
        AND o.pay_txid IS NULL
        AND (
          o.payment_provider NOT IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
          OR NOT EXISTS (
            SELECT 1
              FROM usdt_deposits d
             WHERE d.order_id = o.id
               AND (
                 d.received_usdt > 0
                 OR d.status IN ('confirming', 'confirmed', 'overpaid', 'manual')
               )
          )
        )
        -- Once the buyer reports an Alipay transfer, the operator's account may
        -- already hold the money; the console reconciles it instead of letting
        -- the buyer cancel out from under a pending claim.
        AND (
          o.payment_provider <> 'alipay_manual'
          OR NOT EXISTS (
            SELECT 1
              FROM manual_alipay_payments m
             WHERE m.order_id = o.id
               AND m.order_kind = 'credits'
               AND m.reported_at IS NOT NULL
          )
        )`,
    [orderId, user.id],
  );
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard/membership");

  if (!result.rowCount) {
    // A still-pending order is blocked by funds already seen or a reported
    // transfer. Say so instead of leaving the button silently dead.
    const pending = await query<{ id: string }>(
      `SELECT id FROM orders
        WHERE id = $1 AND user_id = $2 AND status = 'pending'
        LIMIT 1`,
      [orderId, user.id],
    );
    if (pending.rows[0]) redirect(`${returnPath}?cancel=blocked`);
  }
}
