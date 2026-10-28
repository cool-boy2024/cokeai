import {
  SHOP_COPY,
  availabilityLabel,
  deliveryLabel,
  etaLabel,
  warrantyLabel,
  type ShopDeliveryMethod,
  type ShopWarrantyType,
} from "@/lib/shop/copy";

export function AvailabilityBadge({
  availability,
  className = "",
}: {
  availability: string;
  className?: string;
}) {
  const tone =
    availability === "in_stock"
      ? "shop-badge-green"
      : availability === "low_stock"
        ? "shop-badge-yellow"
        : "shop-badge-muted";
  return (
    <span className={`shop-badge ${tone} ${className}`.trim()}>
      <i />
      {availabilityLabel(availability)}
    </span>
  );
}

export function DeliveryBadge({ method }: { method: ShopDeliveryMethod | string }) {
  return <span className="shop-badge shop-badge-muted">{deliveryLabel(method)}</span>;
}

export function WarrantyBadge({
  type,
  days,
}: {
  type: ShopWarrantyType | string;
  days?: number | null;
}) {
  return <span className="shop-badge shop-badge-muted">{warrantyLabel(type, days)}</span>;
}

export function EtaBadge({ min, max }: { min: number; max: number }) {
  return <span className="shop-badge shop-badge-muted">{etaLabel(min, max)}</span>;
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
