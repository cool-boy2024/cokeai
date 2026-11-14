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
  flow = "billing",
  amountYuan,
}: {
  planId: string;
  provider:
    | "stripe"
    | "manual"
    | "alipay_manual"
    | "easypay"
    | "usdt"
    | "usdt_trc20"
    | "usdt_bsc"
    | "usdt_polygon";
  label: string;
  className?: string;
  /** Where manual/bank orders return: recharge history or the membership page. */
  flow?: "billing" | "membership";
  /** Only used by the hidden "custom" recharge plan. */
  amountYuan?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createCheckoutAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="flow" value={flow} />
      {amountYuan ? (
        <input type="hidden" name="amountYuan" value={amountYuan} />
      ) : null}
      <button className={className} type="submit" disabled={pending}>
        {pending ? "正在创建订单…" : label}
        {!pending ? <ArrowUpRight size={14} /> : null}
      </button>
      {state.error ? <div className="form-error mt-8">{state.error}</div> : null}
    </form>
  );
}
