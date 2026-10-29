import type { Metadata } from "next";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  adminCreateShopProductFromOfferAction,
  adminSyncShopAction,
} from "@/app/actions/admin-shop";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { offerAvailabilityLabel } from "@/lib/shop/copy";

export const metadata: Metadata = { title: "小店货源" };
export const dynamic = "force-dynamic";

const OFFER_BADGE_CLASS: Record<string, string> = {
  in_stock: "badge-green",
  low_stock: "badge-yellow",
  out_of_stock: "badge-red",
  missing: "badge",
};

export default async function AdminShopSourcesPage() {
  await requireAdmin();

  const [supplierResult, storeResult, offerResult, statsResult] = await Promise.all([
    query<{
      id: string;
      name: string;
      feed_url: string;
      last_sync_at: string | null;
      last_success_at: string | null;
      last_error: string | null;
      feed_etag: string | null;
    }>(
      `SELECT id, name, feed_url, last_sync_at, last_success_at, last_error, feed_etag
         FROM shop_suppliers WHERE kind = 'aibijia' LIMIT 1`,
    ),
    query<{
      source_store: string;
      total: string;
      in_stock: string;
      low_stock: string;
      out_of_stock: string;
      missing: string;
      mapped: string;
    }>(
      `SELECT o.source_store,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE o.availability = 'in_stock')::text AS in_stock,
              COUNT(*) FILTER (WHERE o.availability = 'low_stock')::text AS low_stock,
              COUNT(*) FILTER (WHERE o.availability = 'out_of_stock')::text AS out_of_stock,
              COUNT(*) FILTER (WHERE o.availability = 'missing')::text AS missing,
              COUNT(*) FILTER (WHERE s.id IS NOT NULL AND s.active = TRUE)::text AS mapped
         FROM shop_offers o
         LEFT JOIN shop_product_sources s ON s.offer_id = o.id
        GROUP BY o.source_store
        ORDER BY COUNT(*) DESC`,
    ),
    query<{
      id: string;
      source_title: string;
      source_store: string;
      price_micros: string;
      availability: string;
      url: string;
      last_seen_at: string;
      product_slug: string | null;
      product_name: string | null;
      product_id: string | null;
      retail_micros: string | null;
    }>(
      `SELECT o.id, o.source_title, o.source_store, o.price_micros, o.availability,
              o.url, o.last_seen_at,
              p.slug AS product_slug, p.name AS product_name, p.id AS product_id,
              p.price_micros AS retail_micros
         FROM shop_offers o
         LEFT JOIN shop_product_sources s ON s.offer_id = o.id AND s.active = TRUE
         LEFT JOIN shop_products p ON p.id = s.product_id
        ORDER BY (s.id IS NULL), o.last_seen_at DESC
        LIMIT 150`,
    ),
    query<{
      offers: string;
      mapped: string;
      stores: string;
      missing: string;
      needs_review: string;
    }>(
      `SELECT COUNT(*)::text AS offers,
              COUNT(*) FILTER (WHERE s.id IS NOT NULL AND s.active = TRUE)::text AS mapped,
              COUNT(DISTINCT o.source_store)::text AS stores,
              COUNT(*) FILTER (WHERE o.availability = 'missing')::text AS missing,
              (SELECT COUNT(*) FROM shop_products WHERE pricing_review_required = TRUE)::text AS needs_review
         FROM shop_offers o
         LEFT JOIN shop_product_sources s ON s.offer_id = o.id`,
    ),
  ]);

  const supplier = supplierResult.rows[0];
  const stats = statsResult.rows[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>货源状态</h1>
          <p>aibijia 公开数据，每小时同步一次。只同步目录、价格、库存和链接。</p>
        </div>
        <form action={adminSyncShopAction}>
          <button className="btn btn-dark btn-sm" type="submit">
            <RefreshCw size={14} /> 立即同步
          </button>
        </form>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">货源条目</div>
          <div className="stat-value">{Number(stats?.offers || 0)}</div>
          <div className="stat-foot">{Number(stats?.stores || 0)} 个店铺</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">已映射</div>
          <div className="stat-value">{Number(stats?.mapped || 0)}</div>
          <div className="stat-foot">用于上架商品</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">连续缺失</div>
          <div className="stat-value">{Number(stats?.missing || 0)}</div>
          <div className="stat-foot">超过阈值显示补货中</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">需复核商品</div>
          <div className="stat-value">{Number(stats?.needs_review || 0)}</div>
          <div className="stat-foot">毛利不足或成本暴涨</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>店铺</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>店铺</th>
                <th>在售</th>
                <th>紧张</th>
                <th>缺货</th>
                <th>缺失</th>
                <th>已映射</th>
              </tr>
            </thead>
            <tbody>
              {storeResult.rows.map((store) => (
                <tr key={store.source_store || "-"}>
                  <td>{store.source_store || "—"}</td>
                  <td>{store.in_stock}</td>
                  <td>{store.low_stock}</td>
                  <td>{store.out_of_stock}</td>
                  <td>{store.missing}</td>
                  <td>{store.mapped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>同步状态</h2>
          </div>
          <span className={`badge ${supplier?.last_error ? "badge-red" : "badge-green"}`}>
            {supplier?.last_error ? "异常" : "正常"}
          </span>
        </div>
        <div className="panel-body">
          <dl className="shop-sync-facts">
            <div>
              <dt>数据源</dt>
              <dd className="shop-break">{supplier?.feed_url || "—"}</dd>
            </div>
            <div>
              <dt>上次同步</dt>
              <dd>{supplier?.last_sync_at ? formatDateTime(supplier.last_sync_at) : "—"}</dd>
            </div>
            <div>
              <dt>上次成功</dt>
              <dd>
                {supplier?.last_success_at ? formatDateTime(supplier.last_success_at) : "—"}
              </dd>
            </div>
            <div>
              <dt>条件请求</dt>
              <dd>{supplier?.feed_etag ? "已启用" : "未启用"}</dd>
            </div>
          </dl>
          {supplier?.last_error ? (
            <p className="shop-form-error mt-16">{supplier.last_error}</p>
          ) : null}
        </div>
      </section>

      <section className="panel mt-16">
        <div className="panel-head">
          <div>
            <h2>货源列表</h2>
          </div>
          <span className="badge">当前显示最近 150 条</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>原始标题（内部）</th>
                <th>店铺</th>
                <th>成本</th>
                <th>库存</th>
                <th>映射商品</th>
                <th>售价 / 毛利</th>
                <th>最近出现</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offerResult.rows.map((offer) => {
                const cost = Number(offer.price_micros);
                const retail = offer.retail_micros ? Number(offer.retail_micros) : 0;
                const margin = retail > 0 ? ((retail - cost) / retail) * 100 : null;
                return (
                  <tr key={offer.id}>
                    <td className="shop-offer-title">{offer.source_title}</td>
                    <td className="nowrap">{offer.source_store}</td>
                    <td className="nowrap">{formatCny(cost)}</td>
                    <td className="nowrap">
                      <span className={`badge ${OFFER_BADGE_CLASS[offer.availability] || ""}`}>
                        {offerAvailabilityLabel(offer.availability)}
                      </span>
                    </td>
                    <td className="nowrap">
                      {offer.product_id ? (
                        <Link href={`/admin/shop/products/${offer.product_id}`}>
                          {offer.product_name}
                        </Link>
                      ) : (
                        <span className="muted">未上架到小店</span>
                      )}
                    </td>
                    <td className="nowrap">
                      {retail > 0 ? formatCny(retail) : "—"}
                      {margin !== null ? (
                        <span className={margin < 15 ? "text-red" : "muted"}>
                          {" "}
                          {margin.toFixed(1)}%
                        </span>
                      ) : null}
                    </td>
                    <td className="nowrap muted">{formatDateTime(offer.last_seen_at)}</td>
                    <td className="text-right">
                      <div className="shop-inline-actions">
                        {!offer.product_id ? (
                          <form action={adminCreateShopProductFromOfferAction}>
                            <input type="hidden" name="offerId" value={offer.id} />
                            <button className="btn btn-dark btn-sm" type="submit">
                              建草稿
                            </button>
                          </form>
                        ) : null}
                        <a
                          className="btn btn-ghost btn-sm"
                          href={offer.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
