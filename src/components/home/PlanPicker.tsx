"use client";

import Link from "next/link";
import { useState } from "react";

export type PickerPlan = {
  id: string;
  name: string;
  tagline: string;
  priceCny: number;
  creditsCny: number;
  highlight: boolean;
};

function yuan(value: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PlanPicker({ plans }: { plans: PickerPlan[] }) {
  const initial = Math.max(
    0,
    plans.findIndex((plan) => plan.highlight),
  );
  const [index, setIndex] = useState(initial);

  if (plans.length === 0) {
    return <p className="plans-empty">充值包正在配置，稍后在这里开放。</p>;
  }

  const plan = plans[Math.min(index, plans.length - 1)];

  return (
    <div className="plans">
      <div className="plans-names" role="group" aria-label="选择充值包">
        {plans.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={i === index ? "is-on" : undefined}
            aria-pressed={i === index}
            onClick={() => setIndex(i)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="plans-stage" aria-live="polite">
        <div className="plans-price">
          <strong>{yuan(plan.priceCny)}</strong>
          <span>元</span>
        </div>
        <p className="plans-tagline">{plan.tagline}</p>
        <dl className="plans-facts">
          <div>
            <dt>到账额度</dt>
            <dd>¥{yuan(plan.creditsCny)}</dd>
          </div>
          <div>
            <dt>余额有效期</dt>
            <dd>不过期</dd>
          </div>
        </dl>
        <Link className="plans-action" href="/dashboard/billing">
          充值{plan.name}
        </Link>
      </div>
    </div>
  );
}
