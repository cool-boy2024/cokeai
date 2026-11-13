import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, PackageSearch, RefreshCw } from "lucide-react";
import { adminSyncShopAction } from "@/app/actions/admin-shop";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { syncStatusLabel } from "@/lib/shop/copy";

export const metadata: Metadata = { title: "小店" };
export const dynamic = "force-dynamic";

type ShopStats = {
  today_revenue: string;
  paid_count: string;
  procuring_count: string;
  delivered_today: string;
  refund_count: string;
  pending_count: string;
  active_products: string;
  paused_products: string;
  draft_products: string;
};

type QueueOrder = {
  id: string;
  order_no: string;
  status: "paid" | "procuring" | "refund_pending";
  amount_micros: string;
  created_at: string;
  paid_at: string | null;
  email: string;
  product_name: string;
};

/** What the operator does next for each state in the queue. */
const QUEUE_ACTIONS = {
  paid: { label: "待采购", action: "去采购" },
  procuring: { label: "采购中", action: "回填交付" },
  refund_pending: { label: "待退款", action: "处理退款" },
} as const;

export default async function AdminShopPage() {
  await requireAdmin();

  const [statsResult, syncResult, queueResult] = await Promise.all([
    query<ShopStats>(
      `SELECT
         COALESCE(SUM(amount_micros) FILTER (
           WHERE status IN ('paid','procuring','delivered') AND paid_at >= date_trunc('day', now())
         ), 0)::text AS today_revenue,
         COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_count,
         COUNT(*) FILTER (WHERE status = 'procuring')::text AS procuring_count,
         COUNT(*) FILTER (WHERE status = 'delivered' AND delivered_at >= date_trunc('day', now()))::text AS delivered_today,
         COUNT(*) FILTER (WHERE status = 'refund_pending')::text AS refund_count,
         COUNT(*) FILTER (
           WHERE status = 'pending_payment' AND expires_at > now()
         )::text AS pending_count,
         (SELECT COUNT(*) FROM shop_products WHERE status = 'active' AND availability IN ('in_stock','low_stock'))::text AS active_products,
         (SELECT COUNT(*) FROM shop_products WHERE pricing_review_required = TRUE)::text AS paused_products,
         (SELECT COUNT(*) FROM shop_products WHERE status = 'draft')::text AS draft_products
       FROM shop_orders`,
    ),
    query<{
      status: string;
      started_at: string;
      finished_at: string | null;
      offers_seen: number;
      price_changes: number;
      stock_changes: number;
      error: string | null;
      last_error: string | null;
      last_success_at: string | null;
    }>(
      `SELECT r.status, r.started_at, r.finished_at, r.offers_seen,
              r.price_changes, r.stock_changes, r.error,
              s.last_error, s.last_success_at
         FROM shop_sync_runs r
         JOIN shop_suppliers s ON s.id = r.supplier_id
        ORDER BY r.started_at DESC LIMIT 1`,
    ),
    query<QueueOrder>(
      `SELECT o.id, o.order_no, o.status, o.amount_micros,
              o.created_at, o.paid_at, u.email,
              COALESCE((
                SELECT string_agg(i.product_name, '、' ORDER BY i.created_at)
                  FROM shop_order_items i
                 WHERE i.order_id = o.id
              ), '') AS product_name
         FROM shop_orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.status IN ('paid', 'procuring', 'refund_pending')
        ORDER BY CASE o.status
                   WHEN 'refund_pending' THEN 0
                   WHEN 'paid' THEN 1
                   ELSE 2
                 END,
                 COALESCE(o.paid_at, o.created_at) ASC
        LIMIT 6`,
    ),
  ]);

  const stats = statsResult.rows[0];
  const sync = syncResult.rows[0];
  const queue = queueResult.rows;
  const paid = Number(stats?.paid_count || 0);
  const procuring = Number(stats?.procuring_count || 0);
  const refunds = Number(stats?.refund_count || 0);
  const deliveredToday = Number(stats?.delivered_today || 0);
  const pendingPayment = Number(stats?.pending_count || 0);
  const activeProducts = Number(stats?.active_products || 0);
  const pausedProducts = Number(stats?.paused_products || 0);
  const draftProducts = Number(stats?.draft_products || 0);

  // The page's one line: what needs a person today. Counts are the same
  // figures the strip and the queue below show.
  const attention = [
    refunds > 0 ? `${refunds} 单等待退款` : "",
    paid > 0 ? `${paid} 单等待去供货商下单` : "",
    procuring > 0 ? `${procuring} 单采购中` : "",
    pausedProducts > 0 ? `${pausedProducts} 个商品暂停展示` : "",
  ].filter(Boolean);
  const summary =
    attention.length > 0 ? `${attention.join("，")}。` : "没有待处理订单，也没有商品等待复核。";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>小店</h1>
          <p>{summary}</p>
        </div>
        <div className="page-head-actions">
          {paid > 0 ? (
            <Link className="btn btn-light btn-sm" href="/admin/shop/orders">
              全部订单
            </Link>
          ) : null}
          <Link
            className="btn btn-dark btn-sm"
            href={paid > 0 ? "/admin/shop/orders?status=paid" : "/admin/shop/orders"}
          >
            {paid > 0 ? `去采购 ${paid} 单` : "全部订单"} <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      <section className="shop-kpis" aria-label="小店概要">
        <Link className="shop-kpi" href="/admin/shop/orders?status=paid">
          <span className="shop-kpi-label">待采购</span>
          <span className="shop-kpi-value">{paid}</span>
          <span className="shop-kpi-foot">付款后去供货商下单</span>
        </Link>
        <Link className="shop-kpi" href="/admin/shop/orders?status=procuring">
          <span className="shop-kpi-label">采购中</span>
          <span className="shop-kpi-value">{procuring}</span>
          <span className="shop-kpi-foot">已下单，等待货源交付</span>
        </Link>
        <Link
          className={`shop-kpi${refunds > 0 ? " is-warn" : ""}`}
          href="/admin/shop/orders?status=refund_pending"
        >
          <span className="shop-kpi-label">待退款</span>
          <span className="shop-kpi-value">{refunds}</span>
          <span className="shop-kpi-foot">{refunds > 0 ? "客户等待退款处理" : "没有退款订单"}</span>
        </Link>
        <div className="shop-kpi">
          <span className="shop-kpi-label">今日收入</span>
          <span className="shop-kpi-value">{formatCny(toNumber(stats?.today_revenue))}</span>
          <span className="shop-kpi-foot">
            今日已交付 {deliveredToday} 单
            {pendingPayment > 0 ? ` · ${pendingPayment} 单待支付` : ""}
          </span>
        </div>
      </section>

      <div className="shop-home-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>待处理订单</h2>
              <p>付款后的订单要去供货商下单，再回填采购信息并交付。</p>
            </div>
            <Link className="btn btn-ghost btn-sm" href="/admin/shop/orders">
              全部
            </Link>
          </div>
          {queue.length === 0 ? (
            <div className="empty">没有待处理订单。新的付款订单会出现在这里。</div>
          ) : (
            <ul className="shop-work-list">
              {queue.map((order) => {
                const action = QUEUE_ACTIONS[order.status];
                return (
                  <li key={order.id} className="shop-work-row">
                    <div className="shop-work-main">
                      <div className="shop-work-title">
                        <span className={`shop-status shop-status-${order.status}`}>
                          {action.label}
                        </span>
                        <strong title={order.product_name}>{order.product_name || "商品"}</strong>
                      </div>
                      <div className="shop-work-meta">
                        <span className="mono">{order.order_no}</span>
                        <span>{order.email}</span>
                        <span>
                          {order.paid_at
                            ? `付款于 ${formatDateTime(order.paid_at)}`
                            : `下单于 ${formatDateTime(order.created_at)}`}
                        </span>
                      </div>
                    </div>
                    <div className="shop-work-side">
                      <span className="shop-work-amount">{formatCny(order.amount_micros)}</span>
                      <Link
                        className="btn btn-light btn-sm"
                        href={`/admin/shop/orders/${order.id}`}
                      >
                        {action.action}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="shop-home-side">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>货源同步</h2>
                <p>{sync ? `最近同步 ${formatDateTime(sync.started_at)}` : "尚未同步"}</p>
              </div>
              <Link className="btn btn-ghost btn-sm" href="/admin/shop/sources">
                <PackageSearch size={14} /> 货源
              </Link>
            </div>
            <div className="panel-body shop-home-sync">
              {sync ? (
                <>
                  <div className="shop-home-sync-status">
                    <span
                      className={`badge ${
                        sync.status === "success"
                          ? "badge-green"
                          : sync.status === "failed"
                            ? "badge-red"
                            : ""
                      }`}
                    >
                      {syncStatusLabel(sync.status)}
                    </span>
                    <form action={adminSyncShopAction}>
                      <button className="btn btn-light btn-sm" type="submit">
                        <RefreshCw size={14} /> 立即同步
                      </button>
                    </form>
                  </div>
                  <dl className="shop-summary shop-summary-tight">
                    <div>
                      <dt>货源条目</dt>
                      <dd>{sync.offers_seen}</dd>
                    </div>
                    <div>
                      <dt>价格变化</dt>
                      <dd>{sync.price_changes}</dd>
                    </div>
                    <div>
                      <dt>库存变化</dt>
                      <dd>{sync.stock_changes}</dd>
                    </div>
                    <div>
                      <dt>上次成功</dt>
                      <dd>{sync.last_success_at ? formatDateTime(sync.last_success_at) : "—"}</dd>
                    </div>
                  </dl>
                  {sync.error || sync.last_error ? (
                    <p className="shop-form-error">{sync.error || sync.last_error}</p>
                  ) : null}
                </>
              ) : (
                <div className="empty">尚未同步。</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>商品</h2>
                <p>前台在售与需要复核的商品。</p>
              </div>
              <Link className="btn btn-ghost btn-sm" href="/admin/shop/products">
                管理
              </Link>
            </div>
            <div className="panel-body shop-home-products">
              <div className="shop-home-product-stats">
                <div>
                  <span>在售</span>
                  <strong>{activeProducts}</strong>
                  <small>公开可购买</small>
                </div>
                <div>
                  <span>需复核</span>
                  <strong className={pausedProducts > 0 ? "is-warn" : ""}>{pausedProducts}</strong>
                  <small>已暂停展示</small>
                </div>
              </div>
              <p className="shop-home-note">
                需复核通常由毛利不足或成本上涨触发，确认售价后恢复展示。
                {draftProducts > 0 ? ` 另有 ${draftProducts} 个草稿待上架。` : ""}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
