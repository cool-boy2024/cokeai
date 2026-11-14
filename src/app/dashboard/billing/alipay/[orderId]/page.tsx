import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { validOrderId } from "@/lib/payments/validation";
import { formatCny } from "@/lib/money";
import { ManualPaymentClaimForm } from "@/components/ManualPaymentClaimForm";
import { CopyButton } from "@/components/CopyButton";

export const metadata: Metadata = { title: "支付宝支付" };
export const dynamic = "force-dynamic";
export default async function AlipayPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { orderId } = await params;
  const queryParams = await searchParams;
  if (!validOrderId(orderId)) notFound();
  const result = await query<{ id: string; status: string; amount_micros: string; qr_data_url: string; payee: string; reported_at: string | null; reported_reference: string | null; payer_note: string | null; credit_status: string | null; plan_kind: string | null }>(
    `SELECT o.id,o.status,o.amount_micros,m.qr_data_url,m.payee,m.reported_at,m.reported_reference,m.payer_note,
            p.kind AS plan_kind,g.status AS credit_status
     FROM orders o JOIN plans p ON p.id=o.plan_id
     JOIN manual_alipay_payments m ON m.order_id=o.id
     LEFT JOIN gateway_balance_ops g ON g.order_id=o.id
     WHERE o.id=$1 AND o.user_id=$2 AND o.payment_provider='alipay_manual'`, [orderId, user.id],
  );
  const order = result.rows[0];
  if (!order) notFound();
  const membership = order.plan_kind === "membership";
  const backHref =
    queryParams.flow === "membership" || membership
      ? "/dashboard/membership"
      : "/dashboard/billing";
  // Membership activation commits in the same transaction that flips the
  // order to paid, so a paid membership order has no pending credit op.
  const paidCopy = membership
    ? "会员已开通，会员价已生效。"
    : order.credit_status === "applied"
      ? "余额已到账。"
      : "余额正在入账，请稍后查看。";
  return <>
    <div className="page-head"><div><h1>支付宝支付</h1><p>CokeAI 小店</p></div><Link className="btn btn-ghost" href={backHref}>返回订单</Link></div>
    {order.status === "pending" ? <div className="payment-settings-grid">
      <section className="panel"><div className="panel-body payment-form">
        {order.reported_at ? <div className="notice">付款信息已提交，等待核实。请勿重复付款。</div> : null}
        <div className="small muted">应付金额</div><div className="balance-amount">{formatCny(order.amount_micros)}</div>
        <img className="payment-qr" src={order.qr_data_url} alt="支付宝收款二维码" />
        <p>收款人：<strong>{order.payee}</strong></p><p className="small muted">请使用支付宝扫码，核对收款人和金额后付款。</p>
        <div className="invite-box"><span className="mono payment-address">{order.id}</span><CopyButton value={order.id} /></div>
        <p className="small muted">付款备注填写订单号前 8 位：{order.id.slice(0,8).toUpperCase()}</p>
      </div></section>
      <section className="panel"><div className="panel-head"><div><h2>提交付款信息</h2><p>商家核实真实到账后完成订单。</p></div></div><div className="panel-body">
        <ManualPaymentClaimForm orderId={order.id} reference={order.reported_reference || ""} note={order.payer_note || ""} />
      </div></section>
    </div> : <section className="panel"><div className="panel-body"><h2>{order.status === "paid" ? "付款已确认" : "订单已关闭"}</h2><p>{order.status === "paid" ? paidCopy : "请勿向此订单继续付款。如已转账，请联系商家核实。"}</p></div></section>}
  </>;
}
