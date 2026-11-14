"use client";

import { useActionState, useState } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import {
  createCheckoutAction,
  type BillingState,
} from "@/app/actions/billing";
import type { CheckoutMethod } from "@/lib/payments/methods";
import {
  CUSTOM_RECHARGE_PLAN_ID,
  parseCustomRechargeMicros,
} from "@/lib/recharge";

const initialState: BillingState = {};

const PRESETS = ["10", "30", "50", "100", "200", "500"];

function formatYuan(raw: string): string {
  const micros = parseCustomRechargeMicros(raw);
  if (micros === null) return "—";
  return `¥${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * Free-form recharge: one amount field and one submit button per payment
 * method. The server re-parses the amount, so the preview here is display only.
 */
export function CustomRechargeForm({ methods }: { methods: CheckoutMethod[] }) {
  const [state, formAction, pending] = useActionState(
    createCheckoutAction,
    initialState,
  );
  const [amount, setAmount] = useState("");

  return (
    <form action={formAction} className="recharge-custom">
      <input type="hidden" name="planId" value={CUSTOM_RECHARGE_PLAN_ID} />
      <input type="hidden" name="flow" value="billing" />

      <div className="recharge-custom-main">
        <label className="field" htmlFor="recharge-amount">
          <span className="recharge-label">充值金额</span>
          <span className="recharge-amount-input">
            <span aria-hidden="true">¥</span>
            <input
              id="recharge-amount"
              name="amountYuan"
              className="mono"
              inputMode="decimal"
              autoComplete="off"
              maxLength={8}
              placeholder="50.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </span>
          <span className="small muted">
            1 元 = 1 元余额，最低 ¥1，最高 ¥10,000，最多两位小数。
          </span>
        </label>

        <div className="recharge-presets" role="group" aria-label="快捷金额">
          {PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={`recharge-preset${amount === value ? " is-active" : ""}`}
              onClick={() => setAmount(value)}
            >
              ¥{value}
            </button>
          ))}
        </div>
      </div>

      <div className="recharge-custom-pay">
        <div className="recharge-custom-summary">
          <span>到账余额</span>
          <strong>{formatYuan(amount)}</strong>
        </div>

        {methods.length === 0 ? (
          <button className="btn btn-ghost btn-block" type="button" disabled>
            支付暂未开放
          </button>
        ) : (
          methods.map((method) => (
            <button
              key={method.provider}
              className={method.className}
              type="submit"
              name="provider"
              value={method.provider}
              disabled={pending}
            >
              {pending ? "正在创建订单…" : method.label}
              {!pending ? <ArrowUpRight size={14} /> : null}
            </button>
          ))
        )}

        {methods.length > 0 ? (
          <p className="small muted recharge-footnote">
            支付成功后余额自动到账，可在小店下单时选择余额支付。
          </p>
        ) : null}

        {state.error ? <div className="form-error">{state.error}</div> : null}
      </div>
    </form>
  );
}
