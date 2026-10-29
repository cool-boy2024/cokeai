import type { PublicShopProduct } from "./catalog";
import { deliveryLabel, etaLabel, warrantyLabel } from "./copy";

const TYPE_LABELS: Record<string, string> = {
  topup: "代充，开通到你的账号",
  giftcard: "卡密，一次性兑换码",
  account: "成品账号，按说明登录",
};

export type ShopIntroFact = {
  label: string;
  value: string;
};

/**
 * The structured facts shown under the product description. The description
 * itself is the product's own `description` field, rendered as entered so the
 * supplier's wording stays intact. Nothing here writes copy on the supplier's
 * behalf.
 */
export function buildShopFacts(product: PublicShopProduct): ShopIntroFact[] {
  return [
    { label: "商品类型", value: TYPE_LABELS[product.product_type] || "数字商品" },
    { label: "交付方式", value: deliveryLabel(product.delivery_method) },
    { label: "预计发货", value: etaLabel(product.eta_min_minutes, product.eta_max_minutes) },
    {
      label: "售后质保",
      value: warrantyLabel(
        product.warranty_type,
        product.warranty_days,
        product.warranty_note,
      ),
    },
  ];
}
