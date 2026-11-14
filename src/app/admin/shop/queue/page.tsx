import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ProcurementCopy } from "@/components/admin-shop/ProcurementCopy";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { decryptCustomerInput } from "@/lib/shop/orders";
import { SHOP_COPY } from "@/lib/shop/copy";

export const metadata: Metadata = { title: "小店采购队列" };
export const dynamic = "force-dynamic";

type QueueRow = {
  id: string;
  order_no: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  amount_micros: string;
  customer_note: string;
  product_name: string;
  qty: number;
  customer_input_encrypted: string | null;
  supplier_offer_id: string | null;
  supplier_cost_micros: string;
  source_store: string | null;
  source_title: string | null;
  url: string | null;
  email: string;
};

export default async function AdminShopQueuePage() {
  await requireAdmin();
  const result = await query<QueueRow>(
    `SELECT o.id, o.order_no, o.status, o.created_at, o.paid_at, o.amount_micros,
            o.customer_note, i.product_name, i.qty, i.customer_input_encrypted,
            i.supplier_offer_id, i.supplier_cost_micros,
            f.source_store, f.source_title, f.url, u.email
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
       JOIN users u ON u.id = o.user_id
       LEFT JOIN shop_offers f ON f.id = i.supplier_offer_id
      WHERE o.status IN ('paid', 'procuring')
      ORDER BY o.paid_at ASC NULLS LAST, o.created_at ASC
      LIMIT 100`,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>采购队列</h1>
          <p>已付款、等待去供货商下单的订单。复制采购信息后打开供货商页面。</p>
        </div>
        <span className="badge badge-dark">{result.rows.length} 笔</span>
      </div>

      {result.rows.length === 0 ? (
        <div className="empty">当前没有待采购订单。</div>
      ) : (
        <div className="shop-queue">
          {result.rows.map((order) => {
            const input = decryptCustomerInput(order.customer_input_encrypted);
            const text = [
              "[CokeAI 采购单]",
              `订单：${order.order_no}`,
              `商品：${order.product_name}`,
              `数量：${order.qty}`,
              `售价：${formatCny(order.amount_micros)}`,
              order.source_store ? `供货商：${order.source_store}` : "",
              order.url ? `供货商链接：${order.url}` : "",
              order.source_title ? `原始标题：${order.source_title}` : "",
              Object.keys(input).length > 0 ? "客户填写：" : "",
              ...Object.entries(input).map(([key, value]) => `- ${key}: ${value}`),
              order.customer_note ? `客户备注：${order.customer_note}` : "",
              "下单后请回填供货商订单号，再上传交付内容。",
            ]
              .filter(Boolean)
              .join("\n");

            return (
              <article className="shop-queue-card" key={order.id}>
                <div className="shop-queue-head">
                  <div>
                    <span className="mono">{order.order_no}</span>
                    <h2>
                      <Link href={`/admin/shop/orders/${order.id}#procurement`}>
                        {order.product_name}
                      </Link>
                    </h2>
                  </div>
                  <span className={`shop-status shop-status-${order.status}`}>
                    {SHOP_COPY.orderStatus[order.status as keyof typeof SHOP_COPY.orderStatus] ||
                      order.status}
                  </span>
                </div>

                <dl className="shop-summary shop-summary-tight">
                  <div>
                    <dt>客户</dt>
                    <dd>{order.email}</dd>
                  </div>
                  <div>
                    <dt>售价 / 成本</dt>
                    <dd>
                      {formatCny(order.amount_micros)} / {formatCny(order.supplier_cost_micros)}
                    </dd>
                  </div>
                  <div>
                    <dt>付款时间</dt>
                    <dd>{order.paid_at ? formatDateTime(order.paid_at) : "—"}</dd>
                  </div>
                  <div>
                    <dt>供货商</dt>
                    <dd>{order.source_store || "未绑定"}</dd>
                  </div>
                </dl>

                {Object.keys(input).length > 0 ? (
                  <div className="shop-queue-input">
                    {Object.entries(input).map(([key, value]) => (
                      <div key={key}>
                        <span>{key}</span>
                        <code>{value}</code>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="shop-queue-actions">
                  <Link
                    className="btn btn-dark btn-sm"
                    href={`/admin/shop/orders/${order.id}#procurement`}
                  >
                    去采购并回填
                  </Link>
                  {order.url ? (
                    <a className="btn btn-light btn-sm" href={order.url} target="_blank" rel="noreferrer">
                      打开供货商页面 <ExternalLink size={13} />
                    </a>
                  ) : (
                    <Link
                      className="btn btn-light btn-sm"
                      href={`/admin/shop/orders/${order.id}#procurement`}
                    >
                      未绑定货源，去处理
                    </Link>
                  )}
                  <ProcurementCopy text={text} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
