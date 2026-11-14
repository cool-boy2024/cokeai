import { config } from "@/lib/config";
import { isEasyPayConfigured } from "./easypay";
import { USDT_NETWORKS, networkForProvider } from "./networks";
import { configuredUsdtNetworks } from "./usdt";
import { getManualAlipaySettings } from "./settings";

export function checkoutProviderLabel(provider: string): string {
  const usdtNetwork = networkForProvider(provider);
  if (usdtNetwork) return USDT_NETWORKS[usdtNetwork].label;
  switch (provider) {
    case "alipay_manual":
    case "alipay_easypay":
      return "支付宝";
    case "stripe":
      return "银行卡";
    case "manual":
      return "人工到账";
    default:
      return provider;
  }
}

export type CheckoutProvider =
  | "stripe"
  | "manual"
  | "alipay_manual"
  | "easypay"
  | "usdt_trc20"
  | "usdt_bsc"
  | "usdt_polygon";

export type CheckoutMethod = {
  provider: CheckoutProvider;
  label: string;
  className: string;
};

/**
 * One button per enabled payment channel, shared by the recharge form, the
 * membership page and the plan grids. Channel switches stay server-side, so
 * the rendered buttons always match what createCheckoutAction will accept.
 */
export async function loadCheckoutMethods(): Promise<{
  methods: CheckoutMethod[];
  labels: string[];
  personalAlipay: Awaited<ReturnType<typeof getManualAlipaySettings>>;
  usdtNetworkIds: Awaited<ReturnType<typeof configuredUsdtNetworks>>;
  alipayReady: boolean;
}> {
  const [personalAlipay, usdtNetworkIds] = await Promise.all([
    getManualAlipaySettings(),
    configuredUsdtNetworks(),
  ]);
  const alipayReady = isEasyPayConfigured();

  const methods: CheckoutMethod[] = [];
  const labels: string[] = [];
  if (personalAlipay.enabled) {
    methods.push({
      provider: "alipay_manual",
      label: "支付宝",
      className: "btn btn-primary btn-block",
    });
    labels.push("支付宝");
  } else if (alipayReady) {
    methods.push({
      provider: "easypay",
      label: "支付宝",
      className: "btn btn-primary btn-block",
    });
    labels.push("支付宝");
  }
  for (const network of usdtNetworkIds) {
    // The checkout form posts the provider id (usdt_trc20…), not the network id.
    methods.push({
      provider: USDT_NETWORKS[network].provider,
      label: USDT_NETWORKS[network].label,
      className: "btn btn-ghost btn-block",
    });
    labels.push(USDT_NETWORKS[network].label);
  }
  if (config.manualPaymentsEnabled && !personalAlipay.enabled) {
    methods.push({
      provider: "manual",
      label: "人工到账",
      className: "btn btn-ghost btn-block",
    });
  }
  if (config.manualPaymentsEnabled) labels.push("人工到账");
  if (config.stripeEnabled) {
    methods.push({
      provider: "stripe",
      label: "银行卡",
      className: "btn btn-ghost btn-block",
    });
    labels.push("银行卡");
  }

  return { methods, labels, personalAlipay, usdtNetworkIds, alipayReady };
}
