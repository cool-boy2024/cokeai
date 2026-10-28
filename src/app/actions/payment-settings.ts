"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getManualAlipaySettings, getUsdtSettings, savePaymentSettings } from "@/lib/payments/settings";
import { deriveTronAddress, validateUsdtXpub } from "@/lib/payments/usdt";
import { qrImageDataUrl } from "@/lib/payments/validation";

export type PaymentSettingsState = { error?: string; saved?: boolean };

export async function saveManualAlipayAction(_prev: PaymentSettingsState, form: FormData): Promise<PaymentSettingsState> {
  const admin = await requireAdmin();
  try {
    const current = await getManualAlipaySettings();
    const enabled = form.get("enabled") === "on";
    const payee = String(form.get("payee") || "").trim();
    if (payee.length > 80) return { error: "收款人名称过长" };
    const image = form.get("qrImage");
    const qrDataUrl = image instanceof File && image.size > 0
      ? qrImageDataUrl(Buffer.from(await image.arrayBuffer())) : current.qrDataUrl;
    if (enabled && (!payee || !qrDataUrl)) return { error: "启用前请填写收款人并上传支付宝收款码" };
    await savePaymentSettings("alipay_manual", enabled, { payee, qrDataUrl }, admin.id);
  } catch {
    return { error: "保存失败。请检查图片格式（PNG/JPG，450 KB 内）后重试。" };
  }
  revalidatePath("/admin/payments");
  revalidatePath("/dashboard/billing");
  return { saved: true };
}

export async function saveUsdtSettingsAction(_prev: PaymentSettingsState, form: FormData): Promise<PaymentSettingsState> {
  const admin = await requireAdmin();
  try {
    const current = await getUsdtSettings();
    const enabled = form.get("enabled") === "on";
    const xpub = String(form.get("xpub") || "").trim() || current.usdtXpub;
    const apiKey = String(form.get("apiKey") || "").trim() || current.usdtTronGridApiKey;
    const firstAddress = String(form.get("firstAddress") || "").trim();
    if (xpub) validateUsdtXpub(xpub);
    if (apiKey.length > 256 || /[\r\n]/.test(apiKey)) return { error: "TronGrid API Key 格式无效" };
    if (enabled) {
      if (!xpub) return { error: "启用前请填写账户 xpub" };
      if (!firstAddress || deriveTronAddress(0, xpub) !== firstAddress) {
        return { error: "钱包首地址与 xpub 不匹配，请在自己的钱包中核对派生路径 m/44'/195'/0'/0/0" };
      }
    }
    await savePaymentSettings("usdt_trc20", enabled, { xpub, apiKey }, admin.id);
  } catch {
    return { error: "保存失败。仅接受 m/44'/195'/0' 的账户 xpub，不接受私钥或助记词。" };
  }
  revalidatePath("/admin/payments");
  revalidatePath("/dashboard/billing");
  return { saved: true };
}
