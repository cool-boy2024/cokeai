import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft, CheckCircle2, Clock3, ShieldAlert, XCircle } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { UsdtPaymentStatus } from "@/components/UsdtPaymentStatus";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { expireUsdtOrderForUser } from "@/lib/payments/usdt";
import { USDT_NETWORKS, networkForProvider } from "@/lib/payments/networks";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "USDT 支付" };
export const dynamic = "force-dynamic";

export default async function UsdtPaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const user = await requireUser();
  const { orderId } = await params;

  const result = await query<{
    id: string;
    status: string;
    amount_micros: string;
    credits_micros: string;
    plan_name: string;
    payment_provider: string;
    pay_amount: string | null;
    pay_address: string | null;
    pay_expires_at: string | null;
    deposit_status: string | null;
    received_usdt: string | null;
    confirmations: number | null;
    txid: string | null;
    credit_status: string | null;
  }>(
    `SELECT o.id, o.status, o.amount_micros, o.credits_micros, p.name AS plan_name,
            o.payment_provider, o.pay_amount, o.pay_address, o.pay_expires_at,
            d.status AS deposit_status, d.received_usdt, d.confirmations, d.txid,
            g.status AS credit_status
       FROM orders o
       JOIN plans p ON p.id = o.plan_id
       LEFT JOIN usdt_deposits d ON d.order_id = o.id
       LEFT JOIN gateway_balance_ops g ON g.order_id = o.id
      WHERE o.id = $1 AND o.user_id = $2
      LIMIT 1`,
    [orderId, user.id],
  );
  const order = result.rows[0];

  if (!order) {
    return (
      <div className="page-head">
        <div>
          <h1>订单不存在</h1>
          <p>这笔订单不属于当前账户。</p>
        </div>
      </div>
    );
  }

  let orderStatus = order.status;
  if (
    orderStatus === "pending" &&
    order.pay_expires_at &&
    new Date(order.pay_expires_at).getTime() <= Date.now()
  ) {
    const cancelled = await expireUsdtOrderForUser(order.id, user.id);
    if (cancelled) orderStatus = "cancelled";
  }
  const paid = orderStatus === "paid";
  const cancelled = orderStatus === "cancelled";
  const creditApplied = order.credit_status === "applied";
  const usdtNetwork = networkForProvider(order.payment_provider);
  const usdtMeta = USDT_NETWORKS[usdtNetwork || "trc20"];
  const requiredConfirmations = usdtMeta.requiredConfirmations;
  const amountUsdt = Number(order.pay_amount || 0);
  const address = order.pay_address || "";
  const qr = address
    ? await QRCode.toDataURL(address, { margin: 1, width: 260 })
    : "";

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="btn btn-ghost btn-sm" href="/dashboard/billing">
            <ArrowLeft size={14} /> 返回充值
          </Link>
          <h1 style={{ marginTop: 16 }}>USDT 支付</h1>
          <p>
            {usdtMeta.label} · {config.usdtQuoteMinutes} 分钟内支付，超时自动取消
          </p>
        </div>
      </div>

      {paid ? (
        <section className="panel">
          <div className="panel-body" style={{ textAlign: "center", padding: 48 }}>
            {creditApplied ? (
              <CheckCircle2 size={40} style={{ color: "var(--success)" }} />
            ) : (
              <Clock3 size={40} style={{ color: "var(--warning, #b7791f)" }} />
            )}
            <h2 style={{ marginTop: 16 }}>
              {creditApplied ? "支付成功" : "支付已确认"}
            </h2>
            <p className="muted">
              {creditApplied
                ? `${formatCny(Number(order.credits_micros))} 余额已到账。`
                : "余额正在入账，通常几分钟内自动补齐。刷新页面可查看最新状态。"}
            </p>
            <Link className="btn btn-primary" href="/dashboard">
              返回概览
            </Link>
          </div>
        </section>
      ) : cancelled ? (
        <section className="panel">
          <div className="panel-body" style={{ textAlign: "center", padding: 48 }}>
            <XCircle size={40} style={{ color: "var(--red)" }} />
            <h2 style={{ marginTop: 16 }}>订单已取消</h2>
            <p className="muted">
              超过 {config.usdtQuoteMinutes} 分钟未到账，或订单已被关闭，余额未扣款。
              如果你在截止时间前已经转账，请联系客服核对。
            </p>
            <Link className="btn btn-primary" href="/dashboard/billing">
              重新充值
            </Link>
          </div>
        </section>
      ) : (
        <div className="grid-2">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>扫码或转账</h2>
                <p>请只使用 {usdtMeta.chainLabel} 网络的 USDT。</p>
              </div>
              <Clock3 size={17} />
            </div>
            <div className="panel-body">
              <div style={{ display: "flex", justifyContent: "center" }}>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt={`${usdtMeta.label} 收款二维码`} width={220} height={220} />
                ) : null}
              </div>
              <div className="small muted" style={{ marginTop: 10, textAlign: "center" }}>
                二维码只包含收款地址，转账时请手动输入下方金额
              </div>
              <div className="small muted" style={{ marginTop: 20 }}>
                应付金额
              </div>
              <div className="balance-amount" style={{ fontSize: 30 }}>
                {amountUsdt.toFixed(2)} <span style={{ fontSize: 16 }}>USDT</span>
              </div>
              <div className="invite-box" style={{ marginTop: 12 }}>
                <input className="input mono" readOnly value={address} />
                <CopyButton value={address} label="复制地址" />
              </div>
              <UsdtPaymentStatus
                orderId={order.id}
                expiresAt={order.pay_expires_at}
                initialStatus={order.deposit_status || "waiting"}
                initialConfirmations={order.confirmations || 0}
                initialReceived={Number(order.received_usdt || 0)}
                initialTxid={order.txid}
                requiredConfirmations={requiredConfirmations}
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>支付说明</h2>
            </div>
            <div className="panel-body">
              <ul className="check-list">
                <li>网络：{usdtMeta.label}</li>
                <li>币种：USDT</li>
                <li>金额：{amountUsdt.toFixed(2)} USDT</li>
                <li>支付时限：{config.usdtQuoteMinutes} 分钟，超时自动取消</li>
                <li>到账确认：{requiredConfirmations} 个区块</li>
                <li>{usdtMeta.transferHint}</li>
              </ul>
              <div className="notice" style={{ marginTop: 20 }}>
                <ShieldAlert size={16} />
                <div>
                  请务必核对网络、地址和金额。链上转账不可撤销，错链或错币可能无法找回。
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 16 }}>
                应付人民币：{formatCny(Number(order.amount_micros))} · 到账余额：
                {formatCny(Number(order.credits_micros))}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
