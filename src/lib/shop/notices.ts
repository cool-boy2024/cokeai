import type { PublicShopProduct } from "./catalog";
import { etaLabel } from "./copy";

export type ShopNoticeGroup = {
  key: string;
  title: string;
  items: string[];
  tone?: "warning";
};

export type ShopNotices = {
  tag: string;
  lead: string;
  groups: ShopNoticeGroup[];
};

const PLATFORM_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Google",
  grok: "X",
};

function platformName(brand: string): string {
  return PLATFORM_NAMES[brand] || "平台";
}

function warrantyDays(product: PublicShopProduct): number {
  return Math.max(0, Number(product.warranty_days) || 0);
}

function hasWarranty(product: PublicShopProduct): boolean {
  if (product.warranty_type === "none") return false;
  if (product.warranty_type === "days") return warrantyDays(product) > 0;
  return true;
}

function warrantyTitle(product: PublicShopProduct): string {
  if (product.warranty_type === "none") return "无质保";
  if (product.warranty_type === "days") return `质保 ${warrantyDays(product)} 天`;
  return "首登质保";
}

function topupWarranty(product: PublicShopProduct): string[] {
  if (product.warranty_type === "none") {
    return [
      "本商品不提供质保。交付完成后的订阅状态变化，不补发、不退款。",
      "账号被平台封禁、限制或扣费，属于账号使用问题，不在售后范围。",
    ];
  }
  if (product.warranty_type === "first_login") {
    return [
      "质保范围为首登：交付后首次登录成功即视为完成。",
      "首次登录失败，经核实可补发或退款；登录成功后的订阅变化不在质保范围。",
      "账号被平台封禁、限制或扣费，属于账号使用问题，不在售后范围。",
    ];
  }
  return [
    `质保 ${warrantyDays(product)} 天，自交付完成起算。`,
    "质保期内非买家原因掉线，经核实优先补开；确实无法补开的，按剩余质保天数退款。",
    "账号被平台封禁、限制或扣费，属于账号使用问题，不在质保范围。",
  ];
}

function giftcardWarranty(product: PublicShopProduct): string[] {
  if (!hasWarranty(product)) {
    return [
      "本商品不提供质保。卡密发出后不支持因兑换或订阅状态变化的补发、退款。",
    ];
  }
  return [
    `${warrantyTitle(product)}，覆盖卡密有效性与兑换环节。`,
    "卡密无效、已被使用或渠道错误导致无法兑换，核实后补发或退款。",
    "兑换成功后订阅掉线、账号封禁或地区限制，不在卡密质保范围。",
  ];
}

function accountWarranty(product: PublicShopProduct): string[] {
  if (!hasWarranty(product)) {
    return ["本商品不提供质保。账号发出后不支持因登录或订阅状态变化的补发、退款。"];
  }
  return [
    `${warrantyTitle(product)}，自交付起算。`,
    "质保期内非买家原因无法登录，核实后补发或按剩余质保天数退款。",
    "账号因买家未及时换绑、修改资料或共享使用导致的被盗、封禁，不在质保范围。",
  ];
}

function productCopyGroups(product: PublicShopProduct): ShopNoticeGroup[] {
  const groups: ShopNoticeGroup[] = [];
  const notice = product.customer_notice.trim();
  const refund = product.refund_policy.trim();
  if (notice) {
    groups.push({ key: "customer-notice", title: "购买须知", items: [notice] });
  }
  if (refund) {
    groups.push({ key: "refund", title: "售后与退款", items: [refund] });
  }
  return groups;
}

function topupNotices(product: PublicShopProduct): ShopNotices {
  const platform = platformName(product.brand);
  return {
    tag: "代充类 · 需登录你的账号",
    lead: `本商品由人工登录你的 ${platform} 账号完成充值。账号信息只在本站订单页填写，客服不会通过聊天索要密码或验证码。`,
    groups: [
      { key: "warranty", title: "质保说明", items: topupWarranty(product) },
      {
        key: "before",
        title: "下单前确认",
        items: [
          `确认 ${platform} 账号可以正常登录，邮箱、密码和两步验证信息可用。`,
          "账号信息使用 AES-256-GCM 加密保存，交付完成 7 天后自动清除，仅用于本次代充。",
          "同一账号不要同时下单多个代充，避免处理冲突。",
        ],
      },
      {
        key: "during",
        title: "处理期间",
        items: [
          "不要修改密码、切换地区或登录设备，保持两步验证可用。",
          `${platform} 可能要求邮箱或手机验证码，需要你配合提供；无法提供时处理时间顺延。`,
          `预计 ${etaLabel(product.eta_min_minutes, product.eta_max_minutes)}。超时未到账请在订单页联系客服，不要重复下单。`,
          "到账后立即修改密码并检查登录设备，移除陌生会话。",
        ],
      },
      {
        key: "exclusions",
        title: "以下情况不属于售后范围",
        tone: "warning",
        items: [
          "账号信息填写错误、账号无法登录，或账号已被平台限制。",
          "处理期间修改密码、切换地区或删除两步验证，导致掉线或会员异常。",
          "到账后因账号共享、违规使用或平台风控导致的封禁、降级。",
          "已到账订单申请无理由退款。",
        ],
      },
      ...productCopyGroups(product),
    ],
  };
}

function giftcardNotices(product: PublicShopProduct): ShopNotices {
  return {
    tag: "卡密类 · 一次性兑换",
    lead: "卡密是一次性数字商品，发出即视为交付。请在本站订单页查看并妥善保存，不要转发给他人。",
    groups: [
      { key: "warranty", title: "质保说明", items: giftcardWarranty(product) },
      {
        key: "before",
        title: "兑换前确认",
        items: [
          "确认登录的是自己的账号，平台、地区和商品名称一致。",
          "收到卡密后 24 小时内完成兑换，逾期失效风险由买家承担。",
          "卡密只在本站订单页查看，不要转发给他人。",
        ],
      },
      {
        key: "failure",
        title: "兑换异常时",
        items: [
          "保留兑换页面截图和错误提示，在订单页联系客服。",
          "核实为卡密本身问题：补发或退款。",
          "核实为填错账号、地区不符或已开通过同类订阅：协助排查，不支持退款。",
        ],
      },
      {
        key: "exclusions",
        title: "以下情况不属于售后范围",
        tone: "warning",
        items: [
          "卡密已兑换成功、已转发他人，或超过 24 小时未兑换。",
          "因填错账号、地区不符、账号已开通同类订阅导致兑换失败。",
          "兑换后因账号违规、共享使用或平台风控导致的封禁、掉线。",
          "数字商品发货后申请无理由退款。",
        ],
      },
      ...productCopyGroups(product),
    ],
  };
}

function accountNotices(product: PublicShopProduct): ShopNotices {
  return {
    tag: "账号类 · 收到后立即换绑",
    lead: "成品账号发出后请立即修改密码并更换两步验证。未及时换绑导致的被盗、掉线，不属于售后范围。",
    groups: [
      { key: "warranty", title: "质保说明", items: accountWarranty(product) },
      {
        key: "rebind",
        title: "收到后立即换绑",
        items: [
          "先用收到的密码登录，立即修改密码并更换两步验证。",
          "删除旧两步验证到添加新验证，请在 1 分钟内完成；操作期间不要关闭页面。",
          "原邮箱的验证码由买家自行保管，我们无法代为接收。",
        ],
      },
      {
        key: "exclusions",
        title: "以下情况不属于售后范围",
        tone: "warning",
        items: [
          "未及时修改密码或换绑两步验证，导致账号被盗或丢失。",
          "删除两步验证后超过 1 分钟未添加新的验证，导致掉线或要求邮箱验证。",
          "买家自行修改邮箱、密码、地区，或共享账号导致的封禁、限制。",
          "数字商品发货后申请无理由退款。",
        ],
      },
      ...productCopyGroups(product),
    ],
  };
}

function genericNotices(product: PublicShopProduct): ShopNotices {
  return {
    tag: "数字商品 · 人工处理",
    lead: "数字商品发出即视为交付。下单前请确认商品内容与使用条件，发货后不支持无理由退款。",
    groups: [
      {
        key: "exclusions",
        title: "以下情况不属于售后范围",
        tone: "warning",
        items: [
          "商品已交付、已兑换或已到账后申请无理由退款。",
          "因买家操作错误、提供信息有误或账号自身限制导致的问题。",
          "因共享账号、违规使用或平台风控导致的封禁、掉线。",
        ],
      },
      ...productCopyGroups(product),
    ],
  };
}

/**
 * Builds the important-notice block shown on every product page. The warranty
 * and responsibility wording follows the product's own type, warranty and
 * delivery fields, so new products get a complete block without extra copy.
 */
export function buildShopNotices(product: PublicShopProduct): ShopNotices {
  switch (product.product_type) {
    case "topup":
      return topupNotices(product);
    case "giftcard":
      return giftcardNotices(product);
    case "account":
      return accountNotices(product);
    default:
      return genericNotices(product);
  }
}
