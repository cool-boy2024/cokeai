"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientIp, requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { easyPayConfigError } from "@/lib/payments/easypay";
import {
  networkForProvider,
  providerForNetwork,
} from "@/lib/payments/networks";
import { getManualAlipaySettings } from "@/lib/payments/settings";
import { isUsdtNetworkConfigured } from "@/lib/payments/usdt";
import { query } from "@/lib/db";
import { fixedWindowLimit } from "@/lib/rate-limit";
import { recordSecurityEventOnce } from "@/lib/security";
import { verifyShopCaptcha } from "@/lib/shop/captcha";
import { createShopEasyPayCheckout } from "@/lib/shop/payments";
import { createShopOrder, revealShopDelivery } from "@/lib/shop/orders";

export type ShopCheckoutState = { error?: string };

export async function createShopCheckoutAction(
  _prev: ShopCheckoutState,
  formData: FormData,
): Promise<ShopCheckoutState> {
  const user = await requireUser();
  const productId = String(formData.get("productId") || "");
  const postedProvider = String(formData.get("provider") || "alipay");
  // Older pages posted the single value "usdt"; treat it as TRC20.
  const provider = postedProvider === "usdt" ? "usdt_trc20" : postedProvider;
  const usdtNetwork = networkForProvider(provider);
  const isUsdt = usdtNetwork !== null;
  const expectedPriceMicros = Number(formData.get("expectedPriceMicros") || 0);

  if (!productId) return { error: "商品不存在，请刷新后重试。" };
  if (!Number.isFinite(expectedPriceMicros) || expectedPriceMicros <= 0) {
    return { error: "商品价格异常，请刷新后重试。" };
  }
  // The shop accepts USDT on configured networks, EasyPay when configured,
  // and the operator's personal Alipay QR when it is enabled.
  if (!isUsdt && provider !== "alipay" && provider !== "alipay_manual") {
    return { error: "支付方式无效。" };
  }

  const captchaOk = await verifyShopCaptcha(
    String(formData.get("captchaToken") || ""),
    String(formData.get("captchaCode") || ""),
  ).catch(() => false);
  if (!captchaOk) {
    return { error: "验证码错误或已过期，请刷新后重试。" };
  }

  const contactEmail = String(formData.get("contactEmail") || "")
    .trim()
    .toLowerCase();
  if (
    contactEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
  ) {
    return { error: "请填写有效的联系邮箱。" };
  }

  const qty = Number(formData.get("qty") || 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > config.shopMaxQty) {
    return { error: `购买数量需在 1 到 ${config.shopMaxQty} 之间。` };
  }

  const limit = await fixedWindowLimit(`shop:order:${user.id}`, 10, 600);
  if (!limit.allowed) {
    const ip = await getClientIp();
    await recordSecurityEventOnce(
      {
        type: "shop",
        ip,
        path: "/shop/checkout",
        method: "POST",
        detail: `order limit 10/10m user=${user.id}`,
      },
      120,
    );
    return { error: "下单过于频繁，请稍后再试。" };
  }
  if (usdtNetwork && !(await isUsdtNetworkConfigured(usdtNetwork))) {
    return { error: "加密货币收款配置中，暂不可下单。" };
  }
  if (provider === "alipay") {
    if (!config.shopEasypayEnabled) {
      return { error: "支付宝（易支付）暂不可用，请选择其他支付方式。" };
    }
    const error = easyPayConfigError();
    if (error) return { error };
  }
  if (provider === "alipay_manual") {
    const settings = await getManualAlipaySettings();
    if (!settings.enabled || !settings.qrDataUrl || !settings.payee) {
      return { error: "支付宝收款暂未开放，请选择其他支付方式。" };
    }
  }
  const product = await query<{ input_fields: Array<{ key?: string }>; name: string }>(
    `SELECT input_fields, name FROM shop_products
      WHERE id = $1 AND status = 'active' AND copy_ready = TRUE LIMIT 1`,
    [productId],
  );
  if (!product.rows[0]) return { error: "商品已下架。" };

  const customerInput: Record<string, string> = {};
  for (const field of Array.isArray(product.rows[0].input_fields)
    ? product.rows[0].input_fields
    : []) {
    const key = String(field?.key || "");
    if (!key) continue;
    const value = formData.get(`input_${key}`);
    if (typeof value === "string" && value.trim()) customerInput[key] = value.trim();
  }

  let created;
  try {
    created = await createShopOrder({
      userId: user.id,
      productId,
      expectedPriceMicros,
      qty,
      contactEmail,
      customerInput,
      note: String(formData.get("note") || ""),
      paymentProvider:
        usdtNetwork !== null
          ? providerForNetwork(usdtNetwork)
          : provider === "alipay_manual"
            ? "alipay_manual"
            : "alipay_easypay",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "下单失败";
    if (message === "PRICE_CHANGED") return { error: "价格已更新，请确认新价格后重新下单。" };
    return { error: message };
  }

  if (provider === "alipay") {
    const maxOrderMicros = Math.round(config.easypayShopMaxOrderCny * 1_000_000);
    if (maxOrderMicros > 0 && created.amountMicros > maxOrderMicros) {
      await cancelPendingShopOrder(created.id, user.id);
      return {
        error: `支付宝单笔限额 ${config.easypayShopMaxOrderCny} 元，请改用 USDT 或联系客服。`,
      };
    }
    const dailyMicros = Math.round(config.easypayShopDailyMaxCny * 1_000_000);
    if (dailyMicros > 0) {
      const used = await query<{ total: string | number }>(
        `SELECT COALESCE(SUM(amount_micros), 0) AS total
           FROM shop_orders
          WHERE payment_provider = 'alipay_easypay'
            AND created_at >= now() - interval '24 hours'
            AND status NOT IN ('cancelled', 'expired')
            AND id <> $1`,
        [created.id],
      );
      const usedMicros = Number(used.rows[0]?.total || 0);
      if (usedMicros + created.amountMicros > dailyMicros) {
        await cancelPendingShopOrder(created.id, user.id);
        return { error: "支付宝通道近 24 小时额度已满，请改用 USDT 或稍后再试。" };
      }
    }

    let checkoutUrl: string;
    try {
      checkoutUrl = createShopEasyPayCheckout({
        orderNo: created.orderNo,
        amountMicros: created.amountMicros,
        productName: product.rows[0].name,
      }).url;
    } catch (error) {
      await cancelPendingShopOrder(created.id, user.id);
      return {
        error: error instanceof Error ? error.message : "支付宝下单失败，请重试。",
      };
    }
    await query(
      "UPDATE shop_orders SET provider_ref = $2, updated_at = now() WHERE id = $1",
      [created.id, `easypay:${created.orderNo}`],
    );
    revalidatePath("/dashboard/shop");
    redirect(checkoutUrl);
  }

  if (provider === "alipay_manual") {
    // createShopOrder already stored the QR snapshot for this order.
    revalidatePath("/dashboard/shop");
    redirect(`/shop/checkout/${created.orderNo}`);
  }

  const { createShopUsdtDeposit } = await import("@/lib/shop/usdt");
  try {
    await createShopUsdtDeposit({
      orderId: created.id,
      amountMicros: created.amountMicros,
      network: usdtNetwork ?? "trc20",
    });
  } catch (error) {
    await cancelPendingShopOrder(created.id, user.id);
    return {
      error: error instanceof Error ? error.message : "USDT 下单失败，请稍后重试。",
    };
  }

  revalidatePath("/dashboard/shop");
  redirect(`/shop/checkout/${created.orderNo}`);
}

async function cancelPendingShopOrder(orderId: string, userId: string): Promise<void> {
  await query(
    `UPDATE shop_orders SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'pending_payment'`,
    [orderId, userId],
  );
  await query(
    `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
     VALUES ($1, 'system', $2, 'cancelled', '支付通道初始化失败')`,
    [orderId, userId],
  );
}

export async function revealShopDeliveryAction(
  orderId: string,
): Promise<{ ok: boolean; payload?: Record<string, string>; note?: string; kind?: string; error?: string }> {
  const user = await requireUser();
  try {
    const result = await revealShopDelivery({ orderId, userId: user.id });
    revalidatePath(`/shop/orders`);
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "查看失败",
    };
  }
}
