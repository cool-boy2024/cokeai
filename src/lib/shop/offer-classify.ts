/**
 * Display-only classification for supplier offers. The feed gives us a title
 * and a store, so the admin page derives a category and a region from keywords
 * instead of storing extra columns. Nothing here affects pricing or listing.
 */
export type OfferCategory =
  | "sms"
  | "account"
  | "subscription"
  | "topup"
  | "code"
  | "api"
  | "other";

export const OFFER_CATEGORIES: { key: OfferCategory; label: string; hint: string }[] = [
  { key: "sms", label: "接码", hint: "短信验证码、收码号码" },
  { key: "account", label: "账号", hint: "成品号、独享/共享账号" },
  { key: "subscription", label: "订阅", hint: "Plus、Pro、Max 等会员" },
  { key: "topup", label: "充值", hint: "代充、续费、直充" },
  { key: "code", label: "卡密", hint: "兑换码、激活码、礼品卡" },
  { key: "api", label: "API", hint: "Key、额度、中转接口" },
  { key: "other", label: "其他", hint: "暂未归类" },
];

export const OFFER_CATEGORY_LABEL: Record<OfferCategory, string> = Object.fromEntries(
  OFFER_CATEGORIES.map((item) => [item.key, item.label]),
) as Record<OfferCategory, string>;

const CATEGORY_RULES: { key: OfferCategory; patterns: RegExp[] }[] = [
  {
    key: "sms",
    patterns: [/接码/, /收码/, /验证码/, /短信/, /号码/, /\bsms\b/i, /codex\s*(接码|收码)/],
  },
  {
    key: "account",
    patterns: [/账号/, /帐号/, /成品/, /独享/, /共享/, /邮箱号/, /老号/, /新号/, /号池/],
  },
  {
    key: "subscription",
    patterns: [
      /会员/,
      /订阅/,
      /套餐/,
      /月卡/,
      /年卡/,
      /季卡/,
      /\bplus\b/i,
      /\bpro\b/i,
      /\bmax\b/i,
      /\bteam\b/i,
    ],
  },
  { key: "topup", patterns: [/充值/, /代充/, /直充/, /续费/, /加油/, /\btop\s*up\b/i] },
  {
    key: "code",
    patterns: [/卡密/, /兑换码/, /激活码/, /礼品卡/, /\bgift\s*card\b/i, /\bredeem\b/i],
  },
  { key: "api", patterns: [/\bapi\b/i, /\bkey\b/i, /\btoken\b/i, /中转/, /额度/, /接口/] },
];

const REGION_RULES: { key: string; label: string; patterns: RegExp[] }[] = [
  { key: "us", label: "美国", patterns: [/美国/, /美区/, /\bus\b/i, /\busa\b/i] },
  { key: "ph", label: "菲律宾", patterns: [/菲律宾/, /菲区/, /\bph\b/i] },
  { key: "jp", label: "日本", patterns: [/日本/, /日区/, /\bjp\b/i] },
  { key: "hk", label: "香港", patterns: [/香港/, /港区/, /\bhk\b/i] },
  { key: "tw", label: "台湾", patterns: [/台湾/, /台区/, /\btw\b/i] },
  { key: "sg", label: "新加坡", patterns: [/新加坡/, /\bsg\b/i] },
  { key: "ca", label: "加拿大", patterns: [/加拿大/, /加区/, /\bca\b/i] },
  { key: "uk", label: "英国", patterns: [/英国/, /英区/, /\buk\b/i, /\bgb\b/i] },
  { key: "vn", label: "越南", patterns: [/越南/, /\bvn\b/i] },
];

export function classifyOffer(title: string): {
  category: OfferCategory;
  region: { key: string; label: string } | null;
} {
  const text = title || "";
  const category =
    CATEGORY_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)))?.key ??
    "other";
  const region =
    REGION_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text))) ?? null;
  return {
    category,
    region: region ? { key: region.key, label: region.label } : null,
  };
}
