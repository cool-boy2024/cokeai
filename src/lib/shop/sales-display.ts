/**
 * 商品页展示口径的纯函数。
 *
 * 放在这个文件里是因为客户端组件（BuyForm）也要用它：这里不能 import
 * 任何数据库代码，否则 `pg` 会被打进浏览器包。
 *
 * 两个数字都来自上游货源公开数据，不做人工编造：
 *   已售   = 上游累计已售件数
 *   剩余   = 上游当前库存；-1 表示「充足」，不展示具体件数
 */

export type ShopSalesDisplay = {
  /** 上游累计已售件数。 */
  sold: number;
  /**
   * 上游当前库存件数；null 表示货源标注为「充足/非常多」这类没有具体件数的
   * 档位。0 表示真的没货了——此时商品不可售。
   */
  remaining: number | null;
  /** 货源标了「充足」但没有具体件数。客户仍然想知道「有货」。 */
  abundant: boolean;
  /** 货源确实没货（remaining === 0）。 */
  soldOut: boolean;
};

/**
 * 把上游的库存字段收敛成一个数字。
 *
 * 上游 `stock` 可能是数字，也可能是「充足 / 非常多 / 一般 / 即将售罄」这类
 * 文字。文字档位不代表具体件数，只有正整数才当作真实库存。
 */
export function normalizeSupplierStock(stock: unknown): number {
  if (typeof stock === "number" && Number.isFinite(stock)) {
    return Math.trunc(stock);
  }
  const text = String(stock ?? "").trim();
  if (/^\d+$/.test(text)) return Number(text);
  // 「充足 / 无限 / 非常多」——有货，但没有具体上限。
  if (/充足|无限|非常多|爆棚|大量|有货|一般/.test(text)) return -1;
  // 「售罄 / 缺货 / 无货 / 下架」——真的没货。
  if (/售罄|缺货|无货|下架|即将售罄|少量|紧张/.test(text)) return 0;
  return -1;
}

export function salesDisplay(input: {
  /** 上游累计已售。 */
  supplierSold: number;
  /** 上游当前库存；-1 = 充足。 */
  supplierStock: number;
}): ShopSalesDisplay {
  const sold = Number.isFinite(input.supplierSold)
    ? Math.max(0, Math.trunc(input.supplierSold))
    : 0;
  const stock = Number.isFinite(input.supplierStock)
    ? Math.trunc(input.supplierStock)
    : -1;
  return {
    sold,
    // 负数（含 -1）表示「充足」，没有具体剩余件数可展示。
    remaining: stock >= 0 ? stock : null,
    abundant: stock < 0,
    soldOut: stock === 0,
  };
}

/**
 * 商品此刻是否真的能买。
 *
 * **徽标和文案必须用同一个判断**，否则会出现「补货中 · 现货充足」这种
 * 自相矛盾的展示：货源标了「充足」，但我们把这件商品停售了。
 */
export function productAvailabilityState(input: {
  availability: string;
  preorder?: boolean;
  soldOut?: boolean;
}): "available" | "unavailable" {
  if (input.soldOut) return "unavailable";
  if (input.preorder) return "available";
  return input.availability === "in_stock" || input.availability === "low_stock"
    ? "available"
    : "unavailable";
}

/**
 * One-line storefront label, e.g. 「已售 88 · 库存 9」.
 *
 * 规则（全站唯一口径）：
 * - 已售永远按上游累计件数显示，0 就不显示，避免满屏「已售 0」；
 * - 能买的时候才写库存：有具体件数写「库存 N」，只有「充足」档位写「现货充足」；
 * - 不能买时只写「已售罄」或不写库存——绝不能在「补货中」旁边挂「现货充足」。
 */
export function salesLabel(
  display: ShopSalesDisplay,
  options: { available?: boolean } = {},
): string {
  const parts: string[] = [];
  if (display.sold > 0) parts.push(`已售 ${display.sold}`);
  if (display.soldOut) {
    parts.push("已售罄");
    return parts.join(" · ");
  }
  if (options.available === false) return parts.join(" · ");
  if (display.remaining !== null && display.remaining > 0) {
    parts.push(`库存 ${display.remaining}`);
  } else if (display.remaining === null && display.abundant) {
    // 货源说「充足」但没有件数。只写「有货」是事实，编一个数字就不是了。
    parts.push("现货充足");
  }
  return parts.join(" · ");
}
