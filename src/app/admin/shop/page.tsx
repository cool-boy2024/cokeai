import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, PackageSearch, RefreshCw } from "lucide-react";
import { adminSyncShopAction } from "@/app/actions/admin-shop";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "小店" };
export const dynamic = "force-dynamic";

type ShopStats = {
  today_revenue: string;
  paid_count: string;
  procuring_count: string;
  delivered_today: string;
  refund_count: string;
  active_products: string;
  paused_products: string;
};

export default async function AdminShopPage() {
  await requireAdmin();

  const [statsResult, syncResult, recentResult] = await Promise.all([
    query<ShopStats>(
      `SELECT
         COALESCE(SUM(amount_micros) FILTER (
           WHERE status IN ('paid','procuring','delivered') AND paid_at >= date_trunc('day', now())
         ), 0)::text AS today_revenue,
         COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_count,
         COUNT(*) FILTER (WHERE status = 'procuring')::text AS procuring_count,
         COUNT(*) FILTER (WHERE status = 'delivered' AND delivered_at >= date_trunc('day', now()))::text AS delivered_today,
         COUNT(*) FILTER (WHERE status = 'refund_pending')::text AS refund_count,
         (SELECT COUNT(*) FROM shop_products WHERE status = 'active' AND availability IN ('in_stock','low_stock'))::text AS active_products,
         (SELECT COUNT(*) FROM shop_products WHERE pricing_review_required = TRUE)::text AS paused_products
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
    query<{
      id: string;
      order_no: string;
      status: string;
      amount_micros: string;
      created_at: string;
      email: string;
      product_name: string;
    }>(
      `SELECT o.id, o.order_no, o.status, o.amount_micros, o.created_at,
              u.email, i.product_name
         FROM shop_orders o
         JOIN users u ON u.id = o.user_id
         JOIN shop_order_items i ON i.order_id = o.id
        ORDER BY o.created_at DESC LIMIT 8`,
    ),
  ]);

  const stats = statsResult.rows[0];
  const sync = syncResult.rows[0];
  const paidAwaiting = Number(stats?.paid_count || 0) + Number(stats?.procuring_count || 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>小店</h1>
          <p>商品、订单、采购与交付。供货商数据每小时同步。</p>
        </div>
        <div className="page-head-actions">
          <form action={adminSyncShopAction}>
            <button className="btn btn-light btn-sm" type="submit">
              <RefreshCw size={14} /> 立即同步
            </button>
          </form>
          <Link className="btn btn-dark btn-sm" href="/admin/shop/orders">
            处理订单 <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      {Number(stats?.refund_count || 0) > 0 ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>有 {stats.refund_count} 笔订单等待退款处理。</div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">今日收入</div>
          <div className="stat-value">{formatCny(toNumber(stats?.today_revenue))}</div>
          <div className="stat-foot">已支付小店订单</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">待采购 / 采购中</div>
          <div className="stat-value">{paidAwaiting}</div>
          <div className="stat-foot">需要去供货商下单</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日已交付</div>
          <div className="stat-value">{Number(stats?.delivered_today || 0)}</div>
          <div className="stat-foot">客户可在订单页查看</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">在售 / 需复核</div>
          <div className="stat-value">
            {Number(stats?.active_products || 0)}
            <span className="muted" style={{ fontSize: 14 }}>
              {" "}
              / {Number(stats?.paused_products || 0)}
            </span>
          </div>
          <div className="stat-foot">需复核会暂停展示</div>
        </div>
      </div>

      <div className="shop-admin-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>最近订单</h2>
            </div>
            <Link className="btn btn-ghost btn-sm" href="/admin/shop/orders">
              全部
            </Link>
          </div>
          {recentResult.rows.length === 0 ? (
            <div className="empty">还没有小店订单。</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>客户</th>
                    <th>商品</th>
                    <th>金额</th>
                    <th>时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recentResult.rows.map((order) => (
                    <tr key={order.id}>
                      <td className="mono nowrap">{order.order_no}</td>
                      <td>{order.email}</td>
                      <td>{order.product_name}</td>
                      <td className="nowrap">{formatCny(order.amount_micros)}</td>
                      <td className="nowrap muted">{formatDateTime(order.created_at)}</td>
                      <td className="text-right">
                        <Link className="btn btn-ghost btn-sm" href={`/admin/shop/orders/${order.id}`}>
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>供货商同步</h2>
            </div>
            <Link className="btn btn-ghost btn-sm" href="/admin/shop/sources">
              <PackageSearch size={14} /> 货源
            </Link>
          </div>
          {sync ? (
            <div className="shop-sync-card">
              <span className={`badge ${sync.status === "success" ? "badge-green" : "badge-red"}`}>
                {sync.status === "success" ? "正常" : sync.status}
              </span>
              <dl className="shop-summary shop-summary-tight">
                <div>
                  <dt>上次同步</dt>
                  <dd>{formatDateTime(sync.started_at)}</dd>
                </div>
                <div>
                  <dt>Offer 数</dt>
                  <dd>{sync.offers_seen}</dd>
                </div>
                <div>
                  <dt>价格 / 库存变化</dt>
                  <dd>
                    {sync.price_changes} / {sync.stock_changes}
                  </dd>
                </div>
                <div>
                  <dt>上次成功</dt>
                  <dd>{sync.last_success_at ? formatDateTime(sync.last_success_at) : "—"}</dd>
                </div>
              </dl>
              {sync.error || sync.last_error ? (
                <p className="shop-form-error">{sync.error || sync.last_error}</p>
              ) : null}
            </div>
          ) : (
            <div className="empty">尚未同步。</div>
          )}
        </section>
      </div>
    </>
  );
}
