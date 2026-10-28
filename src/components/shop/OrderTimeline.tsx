import { SHOP_COPY } from "@/lib/shop/copy";

const STEPS = ["pending_payment", "paid", "procuring", "delivered"] as const;

export function OrderTimeline({ status }: { status: string }) {
  if (status === "cancelled" || status === "expired") {
    return (
      <div className="shop-timeline shop-timeline-closed">
        <span className="shop-step done">{SHOP_COPY.orderStatus[status]}</span>
      </div>
    );
  }
  if (status === "refund_pending" || status === "refunded") {
    return (
      <div className="shop-timeline shop-timeline-closed">
        <span className="shop-step done">{SHOP_COPY.orderStatus[status]}</span>
        <small>退款由人工处理，到账时间以支付渠道为准。</small>
      </div>
    );
  }

  const currentIndex = STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <div className="shop-timeline">
      {STEPS.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <span className={`shop-step ${state}`} key={step}>
            <i />
            {SHOP_COPY.orderStatus[step]}
          </span>
        );
      })}
    </div>
  );
}
