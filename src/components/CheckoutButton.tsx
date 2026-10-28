"use client";

import { useActionState } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import {
  createCheckoutAction,
  type BillingState,
} from "@/app/actions/billing";

const initialState: BillingState = {};

export function CheckoutButton({
  planId,
  provider,
  label,
  className = "btn btn-primary btn-block",
}: {
  planId: string;
  provider: "stripe" | "manual" | "alipay_manual" | "easypay" | "usdt";
  label: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createCheckoutAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="provider" value={provider} />
      <button className={className} type="submit" disabled={pending}>
        {pending ? "正在创建订单…" : label}
        {!pending ? <ArrowUpRight size={14} /> : null}
      </button>
      {state.error ? <div className="form-error mt-8">{state.error}</div> : null}
    </form>
  );
}
