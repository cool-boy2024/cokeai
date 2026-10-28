"use client";
import { useActionState } from "react";
import { submitManualPaymentClaimAction, type ManualPaymentState } from "@/app/actions/manual-payment";
const initial: ManualPaymentState = {};
export function ManualPaymentClaimForm({ orderId, orderKind = "credits", reference = "", note = "" }: { orderId: string; orderKind?: "credits" | "shop"; reference?: string; note?: string }) {
  const [state, action, pending] = useActionState(submitManualPaymentClaimAction, initial);
  return <form action={action} className="payment-form">
    <input type="hidden" name="orderId" value={orderId} />
    <input type="hidden" name="orderKind" value={orderKind} />
    <label className="field">支付宝交易号<input className="input mono" name="reference" required minLength={8} maxLength={80} defaultValue={reference} placeholder="付款后在支付宝账单详情中复制" /></label>
    <label className="field">付款备注（选填）<input className="input" name="payerNote" maxLength={200} defaultValue={note} placeholder="用于协助核对付款" /></label>
    <div aria-live="polite">{state.error ? <p className="form-error" role="alert">{state.error}</p> : state.saved ? <p className="notice notice-green">已提交，等待商家核实到账。请勿重复付款。</p> : null}</div>
    <button className="btn btn-primary" disabled={pending} type="submit">{pending ? "正在提交…" : "提交付款信息"}</button>
  </form>;
}
