import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getManualAlipaySettings, getUsdtNetworkSettings } from "@/lib/payments/settings";
import { USDT_NETWORK_IDS, USDT_NETWORKS } from "@/lib/payments/networks";
import { deriveUsdtAddress } from "@/lib/payments/usdt";
import { PaymentSettingsForm, type UsdtNetworkSettingsView } from "@/components/PaymentSettingsForm";

export const metadata: Metadata = { title: "收款设置" };
export const dynamic = "force-dynamic";

export default async function PaymentSettingsPage() {
  await requireAdmin();
  const [alipay, networkViews] = await Promise.all([
    getManualAlipaySettings(),
    Promise.all(
      USDT_NETWORK_IDS.map(async (network): Promise<UsdtNetworkSettingsView> => {
        const settings = await getUsdtNetworkSettings(network);
        const meta = USDT_NETWORKS[network];
        let firstAddress = "";
        try {
          if (settings.xpub) firstAddress = deriveUsdtAddress(network, 0, settings.xpub);
        } catch {
          // Invalid legacy env is never shown as ready.
        }
        return {
          network,
          label: meta.label,
          path: network === "trc20" ? "m/44'/195'/0'/0/0" : "m/44'/60'/0'/0/0",
          addressPlaceholder: network === "trc20" ? "T…" : "0x…",
          addressMaxLength: network === "trc20" ? 34 : 42,
          showTronApiKey: meta.kind === "tron",
          note: meta.kind === "tron"
            ? "资金留在各订单地址。归集或转出需要你用自己的钱包签名，并准备 TRX / 能量。网站只负责查询到账。"
            : "资金留在各订单地址。归集或转出需要你用自己的钱包签名，并准备少量 BNB / POL 作为 Gas。网站只负责查询到账。",
          enabled: settings.enabled,
          hasXpub: Boolean(settings.xpub),
          hasApiKey: Boolean(settings.apiKey),
          firstAddress,
        };
      }),
    ),
  ]);
  return <>
    <div className="page-head"><div><h1>收款设置</h1><p>配置 CokeAI 小店的支付宝与 USDT 收款。每个 USDT 网络单独配置、单独开关。</p></div><Link className="btn btn-ghost" href="/admin/orders">查看订单</Link></div>
    <PaymentSettingsForm alipay={alipay} usdtNetworks={networkViews} />
  </>;
}
