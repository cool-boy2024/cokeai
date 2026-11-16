import {
  SHOP_COPY,
  availabilityLabel,
  deliveryLabel,
  etaLabel,
  warrantyShortLabel,
  type ShopDeliveryMethod,
  type ShopWarrantyType,
} from "@/lib/shop/copy";
import { salesLabel, type ShopSalesDisplay } from "@/lib/shop/sales-display";

export function AvailabilityBadge({
  availability,
  preorder = false,
  className = "",
}: {
  availability: string;
  preorder?: boolean;
  className?: string;
}) {
  const tone = preorder
    ? "shop-badge-muted"
    : availability === "in_stock"
      ? "shop-badge-green"
      : availability === "low_stock"
        ? "shop-badge-yellow"
        : "shop-badge-muted";
  return (
    <span className={`shop-badge ${tone} ${className}`.trim()}>
      <i />
      {availabilityLabel(availability, preorder)}
    </span>
  );
}

export function DeliveryBadge({
  method,
  preorder = false,
}: {
  method: ShopDeliveryMethod | string;
  preorder?: boolean;
}) {
  return (
    <span className="shop-badge shop-badge-muted">{deliveryLabel(method, preorder)}</span>
  );
}

export function WarrantyBadge({
  type,
  days,
  note,
}: {
  type: ShopWarrantyType | string;
  days?: number | null;
  note?: string | null;
}) {
  return (
    <span className="shop-badge shop-badge-muted">{warrantyShortLabel(type, days, note)}</span>
  );
}

export function EtaBadge({
  min,
  max,
  preorder = false,
}: {
  min: number;
  max: number;
  preorder?: boolean;
}) {
  return (
    <span className="shop-badge shop-badge-muted">{etaLabel(min, max, preorder)}</span>
  );
}

export function SalesBadge({ sales }: { sales: ShopSalesDisplay }) {
  // 没有基数也没有批次的商品不显示计数，避免满屏「已售 0」。
  const label = salesLabel(sales);
  if (!label) return null;
  return (
    <span
      className={`shop-badge shop-badge-sales${sales.soldOut ? " is-sold-out" : ""}`}
    >
      {label}
    </span>
  );
}

export function AvailabilityLegend() {
  return (
    <span className="shop-legend" aria-label="库存状态说明">
      <span>
        <i className="shop-dot-green" /> {SHOP_COPY.availability.in_stock}
      </span>
      <span>
        <i className="shop-dot-yellow" /> {SHOP_COPY.availability.low_stock}
      </span>
      <span>
        <i className="shop-dot-muted" /> {SHOP_COPY.availability.out_of_stock}
      </span>
    </span>
  );
}
