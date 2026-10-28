import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getManualAlipaySettings, getUsdtSettings } from "@/lib/payments/settings";
import { deriveTronAddress } from "@/lib/payments/usdt";
import { PaymentSettingsForm } from "@/components/PaymentSettingsForm";

export const metadata: Metadata = { title: "收款设置" };
export const dynamic = "force-dynamic";
export default async function PaymentSettingsPage() {
  await requireAdmin();
  const [alipay, settings] = await Promise.all([getManualAlipaySettings(), getUsdtSettings()]);
  let firstAddress = "";
  try { if (settings.usdtXpub) firstAddress = deriveTronAddress(0, settings.usdtXpub); } catch { /* invalid legacy env is never shown as ready */ }
  return <>
    <div className="page-head"><div><h1>收款设置</h1><p>配置 CokeAI 小店的支付宝与 USDT 收款。</p></div><Link className="btn btn-ghost" href="/admin/orders">查看订单</Link></div>
    <PaymentSettingsForm alipay={alipay} usdt={{ enabled: settings.usdtEnabled, hasXpub: Boolean(settings.usdtXpub), hasApiKey: Boolean(settings.usdtTronGridApiKey), firstAddress }} />
  </>;
}
