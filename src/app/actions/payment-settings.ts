"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  getManualAlipaySettings,
  getUsdtNetworkSettings,
  savePaymentSettings,
  settingsChannelForNetwork,
  validateNetworkXpub,
} from "@/lib/payments/settings";
import { deriveUsdtAddress } from "@/lib/payments/usdt";
import { USDT_NETWORKS, isUsdtNetwork } from "@/lib/payments/networks";
import { qrImageDataUrl } from "@/lib/payments/validation";

export type PaymentSettingsState = { error?: string; saved?: boolean };

const HD_PATH: Record<"trc20" | "bsc" | "polygon", string> = {
  trc20: "m/44'/195'/0'/0/0",
  bsc: "m/44'/60'/0'/0/0",
  polygon: "m/44'/60'/0'/0/0",
};

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

/**
 * Saves one USDT network. Each chain keeps its own xpub and enable flag;
 * BSC and Polygon share the EVM derivation path but never share an address
 * list with TRON.
 */
export async function saveUsdtSettingsAction(_prev: PaymentSettingsState, form: FormData): Promise<PaymentSettingsState> {
  const admin = await requireAdmin();
  const network = String(form.get("network") || "");
  if (!isUsdtNetwork(network)) return { error: "网络无效" };
  const meta = USDT_NETWORKS[network];
  try {
    const current = await getUsdtNetworkSettings(network);
    const enabled = form.get("enabled") === "on";
    const xpub = String(form.get("xpub") || "").trim() || current.xpub;
    const apiKey = meta.kind === "tron"
      ? String(form.get("apiKey") || "").trim() || current.apiKey
      : "";
    const firstAddress = String(form.get("firstAddress") || "").trim();
    if (xpub) validateNetworkXpub(network, xpub);
    if (apiKey.length > 256 || /[\r\n]/.test(apiKey)) return { error: "TronGrid API Key 格式无效" };
    if (enabled) {
      if (!xpub) return { error: "启用前请填写账户 xpub" };
      const derived = deriveUsdtAddress(network, 0, xpub);
      const matches = meta.kind === "tron"
        ? derived === firstAddress
        : derived.toLowerCase() === firstAddress.toLowerCase();
      if (!firstAddress || !matches) {
        return { error: `钱包首地址与 xpub 不匹配，请在自己的钱包中核对派生路径 ${HD_PATH[network]}` };
      }
    }
    await savePaymentSettings(
      settingsChannelForNetwork(network),
      enabled,
      { xpub, apiKey },
      admin.id,
    );
  } catch {
    return {
      error: `保存失败。仅接受 ${HD_PATH[network].split("/0/0")[0]} 的账户 xpub，不接受私钥或助记词。`,
    };
  }
  revalidatePath("/admin/payments");
  revalidatePath("/dashboard/billing");
  return { saved: true };
}
