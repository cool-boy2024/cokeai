import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { availabilityLabel, productStatusLabel } from "@/lib/shop/copy";
import { preorderSql } from "@/lib/shop/preorder";

export const metadata: Metadata = { title: "小店商品" };
export const dynamic = "force-dynamic";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  status: string;
  availability: string;
  preorder: boolean;
  price_micros: string;
  price_locked: boolean;
  copy_ready: boolean;
  pricing_review_required: boolean;
  cost_micros: string | null;
  sources: string;
  updated_at: string;
};

export default async function AdminShopProductsPage() {
  await requireAdmin();
  const result = await query<ProductRow>(
    `SELECT p.id, p.slug, p.name, p.brand, p.status, p.availability,
            ${preorderSql("p.")} AS preorder,
            p.price_micros, p.price_locked, p.copy_ready, p.pricing_review_required,
            p.updated_at,
            -- Worst active cost, matching the margin breaker and the edit page.
            MAX(s.supplier_cost_micros)::text AS cost_micros,
            COUNT(s.id)::text AS sources
       FROM shop_products p
       LEFT JOIN shop_product_sources s ON s.product_id = p.id AND s.active = TRUE
      GROUP BY p.id
      ORDER BY p.sort_order, p.created_at`,
  );

  // 「最近上新」：按上架时间（没有就用创建时间）倒序，只看最近 14 天。
  // 运营用它确认新同步进来的货有没有漏上架、有没有标错价。
  const recent = await query<{
    id: string;
    slug: string;
    name: string;
    status: string;
    availability: string;
    price_micros: string;
    published_at: string | null;
    created_at: string;
    sources: string;
  }>(
    `SELECT p.id, p.slug, p.name, p.status, p.availability, p.price_micros,
            p.published_at, p.created_at,
            COUNT(s.id)::text AS sources
       FROM shop_products p
       LEFT JOIN shop_product_sources s ON s.product_id = p.id AND s.active = TRUE
      WHERE COALESCE(p.published_at, p.created_at) >= now() - interval '14 days'
      GROUP BY p.id
      ORDER BY COALESCE(p.published_at, p.created_at) DESC
      LIMIT 8`,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>小店商品</h1>
          <p>公开文案、价格和供货来源。保存前会检查文案完整性。</p>
        </div>
        <Link className="btn btn-light btn-sm" href="/admin/shop/sources">
          从货源创建
        </Link>
      </div>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>最近上新</h2>
            <p>最近 14 天新增或上架的商品。还没上架的会标出状态，方便补文案和定价。</p>
          </div>
          <span className="badge">{recent.rows.length} 个</span>
        </div>
        {recent.rows.length === 0 ? (
          <div className="empty">最近 14 天没有新商品。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>上架时间</th>
                  <th>售价</th>
                  <th>库存</th>
                  <th>货源</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.rows.map((product) => (
                  <tr key={`recent-${product.id}`}>
                    <td>
                      <div>{product.name || "未命名商品"}</div>
                      <span className="muted mono">{product.slug}</span>
                    </td>
                    <td className="nowrap muted small">
                      {formatDateTime(product.published_at || product.created_at)}
                      {product.published_at ? "" : "（未上架）"}
                    </td>
                    <td className="nowrap">{formatCny(Number(product.price_micros))}</td>
                    <td className="nowrap small">{availabilityLabel(product.availability)}</td>
                    <td className="nowrap small">{product.sources} 个货源</td>
                    <td className="nowrap">
                      <span className={`shop-status shop-status-${product.status}`}>
                        {productStatusLabel(product.status)}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link
                        className="btn btn-sm btn-ghost"
                        href={`/admin/shop/products/${product.id}`}
                      >
                        编辑
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
            <h2>商品列表</h2>
          </div>
          <span className="badge">{result.rows.length} 个</span>
        </div>
        {result.rows.length === 0 ? (
          <div className="empty">还没有商品。先同步货源，再创建商品草稿。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>品牌</th>
                  <th>售价 / 成本</th>
                  <th>毛利</th>
                  <th>库存</th>
                  <th>文案</th>
                  <th>状态</th>
                  <th>来源</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((product) => {
                  const price = Number(product.price_micros);
                  const cost = product.cost_micros ? Number(product.cost_micros) : 0;
                  const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : null;
                  return (
                    <tr key={product.id}>
                      <td>
                        <div>{product.name || "未命名商品"}</div>
                        <span className="muted mono">{product.slug}</span>
                      </td>
                      <td>{product.brand}</td>
                      <td className="nowrap">
                        {formatCny(price)}
                        {product.price_locked ? (
                          <span className="badge badge-yellow" title="手动售价，货源同步不会覆盖">
                            手动
                          </span>
                        ) : null}
                        {cost > 0 ? (
                          <span className="muted"> / {formatCny(cost)}</span>
                        ) : null}
                      </td>
                      <td className={margin !== null && margin < 15 ? "text-red" : ""}>
                        {margin === null ? "—" : `${margin.toFixed(1)}%`}
                      </td>
                      <td>
                        <span className="badge">
                          {availabilityLabel(product.availability, product.preorder)}
                        </span>
                      </td>
                      <td>
                        {product.copy_ready ? (
                          <span className="badge badge-green">完整</span>
                        ) : (
                          <span className="badge badge-yellow">待补齐</span>
                        )}
                      </td>
                      <td>
                        <span className="badge">{productStatusLabel(product.status)}</span>
                        {product.pricing_review_required ? (
                          <span className="badge badge-red">需复核</span>
                        ) : null}
                      </td>
                      <td>{product.sources}</td>
                      <td className="text-right">
                        <Link
                          className="btn btn-ghost btn-sm"
                          href={`/admin/shop/products/${product.id}`}
                        >
                          编辑
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
