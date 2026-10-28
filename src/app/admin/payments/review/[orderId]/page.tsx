import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCny } from "@/lib/money";
import { validOrderId } from "@/lib/payments/validation";
import { reviewManualPaymentAction } from "@/app/actions/manual-payment";
export const dynamic = "force-dynamic";
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { orderId } = await params;
  const { error } = await searchParams;
  if (!validOrderId(orderId)) notFound();
  const result = await query<{ id: string; status: string; email: string; amount_micros: string; payee: string | null; reported_reference: string | null; payer_note: string | null }>(
    `SELECT o.id,o.status,o.amount_micros,u.email,m.payee,m.reported_reference,m.payer_note FROM orders o
     JOIN users u ON u.id=o.user_id LEFT JOIN manual_alipay_payments m ON m.order_id=o.id
     WHERE o.id=$1 AND o.payment_provider IN ('manual','alipay_manual')`, [orderId],
  );
  const order = result.rows[0];
  if (!order) notFound();
  return <>
    <div className="page-head"><div><h1>核实到账</h1><p className="mono payment-address">{order.id}</p></div><Link className="btn btn-ghost" href="/admin/orders">返回订单</Link></div>
    {error ? <div role="alert" className="notice notice-red">{error}</div> : null}
    <div className="payment-settings-grid">
      <section className="panel"><div className="panel-head"><h2>订单与客户申报</h2></div><div className="panel-body payment-form">
        <p>客户：{order.email}</p><p>订单金额：<strong>{formatCny(order.amount_micros)}</strong></p><p>收款人：{order.payee || "人工收款"}</p>
        <p className="payment-address">客户填写的交易号：{order.reported_reference || "尚未提交"}</p><p>客户备注：{order.payer_note || "无"}</p>
        <div className="notice">客户填写的信息仅供核对。请打开你自己的支付宝账单，确认收款成功、交易号、金额及订单归属。</div>
      </div></section>
      <section className="panel"><div className="panel-head"><h2>实际到账记录</h2></div><div className="panel-body">
        {order.status !== "pending" ? <p>该订单已处理，当前状态：{order.status}</p> : <form action={reviewManualPaymentAction} className="payment-form">
          <input type="hidden" name="orderId" value={order.id} />
          <label className="field">收款账单中的完整交易号<input className="input mono" name="receiptRef" required minLength={8} maxLength={80} autoComplete="off" /></label>
          <label className="field">实际到账金额（元）<input className="input" name="amountYuan" required inputMode="decimal" placeholder="按真实收款账单填写" /></label>
          <label className="payment-check"><input type="checkbox" name="checked" required /> 我已核对真实到账，并确认这笔交易属于当前订单</label>
          <button className="btn btn-primary" type="submit">确认到账并完成订单</button>
        </form>}
      </div></section>
    </div>
  </>;
}
