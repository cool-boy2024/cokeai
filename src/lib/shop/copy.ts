import { formatCny } from "@/lib/money";

export type ShopAvailability = "in_stock" | "low_stock" | "out_of_stock" | "paused";
export type ShopWarrantyType = "first_login" | "days" | "none";
export type ShopDeliveryMethod = "manual" | "auto";

export type ShopInputField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "textarea";
  required?: boolean;
  maxLength?: number;
  help?: string;
};

export type ShopProductCopy = {
  name: string;
  subtitle: string;
  description: string;
  includes: string[];
  usage_notes: string[];
  customer_notice: string;
  refund_policy: string;
  eta_min_minutes: number;
  eta_max_minutes: number;
  warranty_type: ShopWarrantyType;
  warranty_days: number;
  input_fields: ShopInputField[];
};

export const SHOP_COPY = {
  availability: {
    in_stock: "现货",
    low_stock: "库存紧张",
    out_of_stock: "补货中",
    paused: "补货中",
  } as const satisfies Record<ShopAvailability, string>,

  delivery: {
    manual: "人工发货",
    auto: "自动发货",
  } as const satisfies Record<ShopDeliveryMethod, string>,

  /**
   * Storefront wording for supplier preorders (库存不足，可预订). It must not
   * promise a stock position or a delivery time: the supplier ships in
   * reservation order and the ETA fields are not meaningful for these items.
   */
  preorder: {
    availability: "预定",
    delivery: "人工处理",
    eta: "按预定顺序发货",
  },

  sections: {
    includes: "你将收到",
    description: "商品说明",
    usage: "使用说明",
    notice: "购买须知",
    refund: "售后说明",
    support: "需要帮助",
  },

  buy: {
    buyNow: "立即购买",
    outOfStock: "补货中",
    loginFirst: "登录后购买",
    priceUpdated: "价格已更新，请确认后重新下单",
    soldOutHint: "暂时缺货，补货后即可下单",
  },

  orderStatus: {
    pending_payment: "待支付",
    paid: "已支付",
    procuring: "采购中",
    delivered: "已完成",
    cancelled: "已取消",
    expired: "已过期",
    refund_pending: "退款处理中",
    refunded: "已退款",
  } as const,
};

export function availabilityLabel(
  value: ShopAvailability | string | null | undefined,
  preorder = false,
): string {
  if (preorder) return SHOP_COPY.preorder.availability;
  if (!value) return SHOP_COPY.availability.out_of_stock;
  return SHOP_COPY.availability[value as ShopAvailability] || SHOP_COPY.availability.out_of_stock;
}

/**
 * Supplier offer stock states. "missing" means the offer has been absent from
 * the feed for several runs, not that the supplier is sold out today.
 */
const OFFER_AVAILABILITY_LABELS: Record<string, string> = {
  in_stock: "有货",
  low_stock: "库存紧张",
  out_of_stock: "缺货",
  missing: "连续缺失",
};

export function offerAvailabilityLabel(value: string | null | undefined): string {
  if (!value) return "未知";
  return OFFER_AVAILABILITY_LABELS[value] || value;
}

const PRODUCT_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  active: "已上架",
  paused: "已暂停",
  archived: "已归档",
};

export function productStatusLabel(value: string | null | undefined): string {
  if (!value) return "未知";
  return PRODUCT_STATUS_LABELS[value] || value;
}

const SYNC_STATUS_LABELS: Record<string, string> = {
  success: "正常",
  partial: "部分成功",
  failed: "失败",
};

export function syncStatusLabel(value: string | null | undefined): string {
  if (!value) return "未知";
  return SYNC_STATUS_LABELS[value] || value;
}

export function deliveryLabel(
  value: ShopDeliveryMethod | string | null | undefined,
  preorder = false,
): string {
  if (preorder) return SHOP_COPY.preorder.delivery;
  return value === "auto" ? SHOP_COPY.delivery.auto : SHOP_COPY.delivery.manual;
}

export function warrantyLabel(
  type: ShopWarrantyType | string | null | undefined,
  days?: number | null,
  note?: string | null,
): string {
  const custom = note?.trim();
  if (custom) return custom;
  if (type === "none") return "无质保";
  if (type === "days") {
    const count = Number(days || 0);
    return count > 0 ? `质保 ${count} 天` : "质保";
  }
  return "首登质保";
}

/**
 * Compact warranty text for cards and badges. The full supplier wording lives
 * in `warrantyLabel` / the product facts; long notes would break the card footer.
 */
export function warrantyShortLabel(
  type: ShopWarrantyType | string | null | undefined,
  days?: number | null,
  note?: string | null,
): string {
  const custom = note?.trim();
  if (!custom) return warrantyLabel(type, days);
  const head = custom.split(/[；;，,。]/)[0]?.trim() || "";
  return head && head.length <= 12 ? head : "按商品说明";
}

export function etaLabel(minMinutes: number, maxMinutes: number, preorder = false): string {
  // The supplier's ETA is a stock-based estimate. For a preorder it would
  // read as a delivery promise we cannot keep, so show the queue wording.
  if (preorder) return SHOP_COPY.preorder.eta;
  const min = Math.max(0, Number(minMinutes) || 0);
  const max = Math.max(min, Number(maxMinutes) || 0);
  if (max === 0) return "尽快发货";
  if (min === 0) return `${max} 分钟内发货`;
  if (min === max) return `${min} 分钟内发货`;
  return `${min} 至 ${max} 分钟发货`;
}

export function productPriceLabel(micros: number | string): string {
  return formatCny(micros, 2);
}

export function isPurchasable(availability: ShopAvailability | string | null | undefined): boolean {
  return availability === "in_stock" || availability === "low_stock";
}

function nonEmpty(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * Returns every missing public-copy field. A product cannot be published while
 * this list is non-empty. Used by the admin editor and enforced again on save.
 */
type ShopProductCopyInput = Partial<Omit<ShopProductCopy, "warranty_type">> & {
  warranty_type?: string;
};

export function validateProductCopy(product: ShopProductCopyInput): string[] {
  const missing: string[] = [];
  if (!nonEmpty(product.name)) missing.push("商品名称");
  if (!nonEmpty(product.subtitle)) missing.push("副标题");
  if (!nonEmpty(product.description)) missing.push("商品说明");
  if (stringList(product.includes).length === 0) missing.push("你将收到");
  if (stringList(product.usage_notes).length === 0) missing.push("使用说明");
  if (!nonEmpty(product.customer_notice)) missing.push("购买须知");
  if (!nonEmpty(product.refund_policy)) missing.push("售后说明");
  if (!Number.isFinite(product.eta_max_minutes) || Number(product.eta_max_minutes) <= 0) {
    missing.push("发货时效");
  }
  if (!product.warranty_type) missing.push("质保说明");
  if (product.warranty_type === "days" && !(Number(product.warranty_days) > 0)) {
    missing.push("质保天数");
  }
  for (const field of Array.isArray(product.input_fields) ? product.input_fields : []) {
    if (!field?.key || !field?.label) {
      missing.push("客户输入字段");
      break;
    }
  }
  return missing;
}

export function parseStringList(value: unknown): string[] {
  return stringList(value);
}

export function parseInputFields(value: unknown): ShopInputField[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const type: ShopInputField["type"] =
        item.type === "password" || item.type === "textarea" ? item.type : "text";
      return {
        key: String(item.key || "").trim(),
        label: String(item.label || "").trim(),
        placeholder: item.placeholder ? String(item.placeholder) : undefined,
        type,
        required: Boolean(item.required),
        maxLength: Number.isFinite(Number(item.maxLength)) ? Number(item.maxLength) : undefined,
        help: item.help ? String(item.help) : undefined,
      };
    })
    .filter((item) => item.key && item.label);
}
