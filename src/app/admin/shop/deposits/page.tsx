import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { USDT_NETWORKS, isUsdtNetwork } from "@/lib/payments/networks";
import { SHOP_COPY } from "@/lib/shop/copy";

export const metadata: Metadata = { title: "USDT 到账" };
export const dynamic = "force-dynamic";

type DepositRow = {
  id: string;
  network: string;
  address: string;
  expected_usdt: string;
  received_usdt: string;
  txid: string | null;
  confirmations: number;
  status: string;
  expires_at: string;
  updated_at: string;
  order_id: string;
  order_no: string;
  order_status: string;
  product_name: string | null;
  email: string;
};

const STATUS_LABEL: Record<string, string> = {
  waiting: "等待到账",
  partial: "部分到账",
  confirming: "确认中",
  confirmed: "已确认",
  overpaid: "超额到账",
  expired: "已过期",
  manual: "需人工处理",
};

function usdt(value: string | number): string {
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

export default async function AdminShopDepositsPage() {
  await requireAdmin();
  const result = await query<DepositRow>(
    `SELECT d.id, d.network, d.address, d.expected_usdt, d.received_usdt,
            d.txid, d.confirmations, d.status, d.expires_at, d.updated_at,
            o.id AS order_id, o.order_no, o.status AS order_status,
            i.product_name, u.email
       FROM shop_usdt_deposits d
       JOIN shop_orders o ON o.id = d.order_id
       JOIN users u ON u.id = o.user_id
       LEFT JOIN LATERAL (
         SELECT product_name FROM shop_order_items
          WHERE order_id = o.id ORDER BY created_at LIMIT 1
       ) i ON TRUE
      ORDER BY CASE d.status
                 WHEN 'manual' THEN 0
                 WHEN 'partial' THEN 1
                 WHEN 'confirming' THEN 2
                 WHEN 'waiting' THEN 3
                 ELSE 4
               END,
               d.updated_at DESC
      LIMIT 200`,
  );
  const rows = result.rows;
  const attention = rows.filter((row) => row.status === "manual" || row.status === "partial").length;

  return (
    <>
      <Link className="shop-back" href="/admin/shop/orders">
        <ArrowLeft size={14} /> 小店订单
      </Link>

      <div className="page-head">
        <div>
          <h1>USDT 到账</h1>
          <p>链上收款记录。部分到账和需人工处理的记录请优先核实。</p>
        </div>
        {attention > 0 ? <span className="badge text-red">{attention} 笔待处理</span> : null}
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>最近 200 笔</h2>
          </div>
          <span className="badge">{rows.length} 条</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">还没有 USDT 收款记录。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单</th>
                  <th>客户 / 商品</th>
                  <th>网络</th>
                  <th>应付 / 实收</th>
                  <th>确认数</th>
                  <th>状态</th>
                  <th>最近检查</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const network = isUsdtNetwork(row.network) ? row.network : "trc20";
                  return (
                    <tr key={row.id}>
                      <td className="mono nowrap">
                        {row.order_no}
                        <div className="muted">
                          {SHOP_COPY.orderStatus[
                            row.order_status as keyof typeof SHOP_COPY.orderStatus
                          ] || row.order_status}
                        </div>
                      </td>
                      <td>
                        <div>{row.email}</div>
                        <span className="muted">{row.product_name || "—"}</span>
                      </td>
                      <td className="nowrap">{USDT_NETWORKS[network].label}</td>
                      <td className="nowrap">
                        {usdt(row.expected_usdt)} / {usdt(row.received_usdt)}
                        <div className="muted mono">{row.address.slice(0, 10)}…</div>
                      </td>
                      <td>{Number(row.confirmations)}</td>
                      <td className={row.status === "manual" || row.status === "partial" ? "text-red" : ""}>
                        {STATUS_LABEL[row.status] || row.status}
                        {row.txid ? <div className="muted mono">{row.txid.slice(0, 12)}…</div> : null}
                      </td>
                      <td className="nowrap muted">
                        {row.updated_at ? formatDateTime(row.updated_at) : "—"}
                      </td>
                      <td className="text-right">
                        <Link className="btn btn-ghost btn-sm" href={`/admin/shop/orders/${row.order_id}`}>
                          <ExternalLink size={13} /> 订单
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
