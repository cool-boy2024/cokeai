import type { PublicShopProduct } from "./catalog";
import { deliveryLabel, etaLabel, warrantyLabel } from "./copy";

const PLATFORM_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Google",
  grok: "X",
};

const TYPE_LABELS: Record<string, string> = {
  topup: "代充，开通到你的账号",
  giftcard: "卡密，一次性兑换码",
  account: "成品账号，交付后换绑",
};

export type ShopIntroGroup = {
  title: string;
  items: string[];
};

export type ShopIntro = {
  paragraphs: string[];
  groups: ShopIntroGroup[];
  facts: Array<{ label: string; value: string }>;
};

/**
 * Builds the product introduction from the product's own type, delivery and
 * warranty fields. Nothing here is specific to one supplier listing, so new
 * products get a complete introduction without hand-written copy.
 */
export function buildShopIntro(product: PublicShopProduct): ShopIntro {
  const platform = PLATFORM_NAMES[product.brand] || "平台";
  const facts = [
    { label: "商品类型", value: TYPE_LABELS[product.product_type] || "数字商品" },
    { label: "交付方式", value: deliveryLabel(product.delivery_method) },
    { label: "预计发货", value: etaLabel(product.eta_min_minutes, product.eta_max_minutes) },
    { label: "售后质保", value: warrantyLabel(product.warranty_type, product.warranty_days) },
  ];

  switch (product.product_type) {
    case "topup":
      return {
        facts,
        paragraphs: [
          `代充是在你自己已有的 ${platform} 账号上开通订阅，账号里的聊天记录、设置和历史都会保留。交付完成后，我们不会继续登录你的账号。`,
          "下单时需要填写账号登录信息，客服只在本次代充期间使用，交付完成 7 天后自动清除。处理期间请保持密码、地区和两步验证不变。",
        ],
        groups: [
          {
            title: "适合",
            items: [`已有 ${platform} 账号，需要续开或开通订阅，但自己完成支付不方便。`],
          },
          {
            title: "需要你配合",
            items: [
              "在发货时效内提供登录验证码或配合完成验证。",
              "不要多人共享账号，也不要在处理期间切换登录地区。",
            ],
          },
        ],
      };
    case "giftcard":
      return {
        facts,
        paragraphs: [
          "卡密是官方渠道的兑换码，不需要提供账号密码。收到卡密后，在订单页按兑换说明操作即可。",
          "卡密发出即视为交付。兑换前请确认登录的是自己的账号，地区与套餐和商品名称一致。",
        ],
        groups: [
          {
            title: "适合",
            items: ["想自己完成兑换，不希望把账号密码交给别人的用户。"],
          },
          {
            title: "需要你配合",
            items: [
              "在 24 小时内完成兑换，并保留兑换页面的截图。",
              "兑换异常时先不要重复下单，在订单页联系客服核实。",
            ],
          },
        ],
      };
    case "account":
      return {
        facts,
        paragraphs: [
          "成品账号交付后请立即修改密码并更换两步验证。账号资料和订阅归属以商品说明和订单页信息为准。",
          "未及时换绑导致账号被找回、丢失或封禁，不属于售后范围。",
        ],
        groups: [
          {
            title: "适合",
            items: ["需要独立账号，收到后能立即完成换绑的用户。"],
          },
          {
            title: "需要你配合",
            items: [
              "收到账密后先登录，再修改密码和两步验证。",
              "不要共享账号，也不要用于平台禁止的用途。",
            ],
          },
        ],
      };
    default:
      return { facts, paragraphs: [], groups: [] };
  }
}
