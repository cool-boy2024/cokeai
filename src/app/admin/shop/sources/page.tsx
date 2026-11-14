import type { Metadata } from "next";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  adminBulkShopOfferImportAction,
  adminCreateShopProductFromOfferAction,
  adminRunShopImportQueueAction,
  adminSaveShopSourceSettingsAction,
  adminStartShopOfferImportAction,
  adminSyncShopAction,
} from "@/app/actions/admin-shop";
import { ImportJobWatcher } from "@/components/admin-shop/ImportJobWatcher";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { suggestRetailPrice } from "@/lib/shop/catalog";
import {
  getShopSourceSettings,
  getShopTargetMarginBps,
} from "@/lib/shop/settings";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import {
  OFFER_CATEGORIES,
  OFFER_CATEGORY_LABEL,
  classifyOffer,
  type OfferCategory,
} from "@/lib/shop/offer-classify";
import { offerAvailabilityLabel } from "@/lib/shop/copy";

export const metadata: Metadata = { title: "小店货源" };
export const dynamic = "force-dynamic";

/**
 * Sync failures quote the feed address in their message. Operators see the
 * error, so strip the supplier host and any raw URL before it reaches the page.
 */
function redactSource(text: string): string {
  const host = (() => {
    try {
      return new URL(config.shopFeedUrl).host;
    } catch {
      return "";
    }
  })();
  let out = host ? text.split(host).join("数据源") : text;
  out = out.split(config.shopFeedUrl).join("数据源");
  return out.replace(/https?:\/\/[^\s"'<>]+/gi, "数据源");
}

const OFFER_BADGE_CLASS: Record<string, string> = {
  in_stock: "badge-green",
  low_stock: "badge-yellow",
  out_of_stock: "badge-red",
  missing: "badge",
};

type SearchParams = Record<string, string | undefined>;

type OfferRow = {
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
  product_status: string | null;
  retail_micros: string | null;
  import_status: string | null;
  import_note: string | null;
  import_error: string | null;
};

export default async function AdminShopSourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [sourceSettings, targetMarginBps] = await Promise.all([
    getShopSourceSettings(),
    getShopTargetMarginBps(),
  ]);

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
    query<OfferRow>(
      `SELECT o.id, o.source_title, o.source_store, o.price_micros, o.availability,
              o.url, o.last_seen_at,
              p.slug AS product_slug, p.name AS product_name, p.id AS product_id,
              p.status AS product_status, p.price_micros AS retail_micros,
              j.status AS import_status, j.note AS import_note, j.error AS import_error
         FROM shop_offers o
         LEFT JOIN LATERAL (
           SELECT sp.slug, sp.name, sp.id, sp.status, sp.price_micros
             FROM shop_product_sources s
             JOIN shop_products sp ON sp.id = s.product_id
            WHERE s.offer_id = o.id AND s.active = TRUE
            ORDER BY s.created_at ASC
            LIMIT 1
         ) p ON TRUE
         LEFT JOIN LATERAL (
           SELECT status, note, error
             FROM shop_import_jobs
            WHERE offer_id = o.id
            ORDER BY created_at DESC
            LIMIT 1
         ) j ON TRUE
        ORDER BY (p.id IS NULL), o.last_seen_at DESC
        LIMIT 1000`,
    ),
    query<{
      offers: string;
      mapped: string;
      stores: string;
      missing: string;
      needs_review: string;
      import_pending: string;
    }>(
      `SELECT (SELECT COUNT(*) FROM shop_offers)::text AS offers,
              (SELECT COUNT(DISTINCT offer_id) FROM shop_product_sources WHERE active = TRUE)::text AS mapped,
              (SELECT COUNT(DISTINCT source_store) FROM shop_offers)::text AS stores,
              (SELECT COUNT(*) FROM shop_offers WHERE availability = 'missing')::text AS missing,
              (SELECT COUNT(*) FROM shop_products WHERE pricing_review_required = TRUE)::text AS needs_review,
              (SELECT COUNT(*) FROM shop_import_jobs WHERE status IN ('queued', 'running'))::text AS import_pending`,
    ),
  ]);

  const supplier = supplierResult.rows[0];
  const stats = statsResult.rows[0];

  const classified = offerResult.rows.map((offer) => {
    const meta = classifyOffer(offer.source_title);
    return { ...offer, ...meta };
  });

  const categoryCounts = new Map<OfferCategory, number>();
  const regionCounts = new Map<string, number>();
  for (const offer of classified) {
    categoryCounts.set(offer.category, (categoryCounts.get(offer.category) ?? 0) + 1);
    if (offer.region) {
      regionCounts.set(offer.region.key, (regionCounts.get(offer.region.key) ?? 0) + 1);
    }
  }

  const categoryKeys = new Set<string>(OFFER_CATEGORIES.map((item) => item.key));
  const requestedCategory = params.cat || "all";
  const activeCategory: OfferCategory | "all" =
    requestedCategory === "all" || categoryKeys.has(requestedCategory)
      ? (requestedCategory as OfferCategory | "all")
      : "all";
  const activeRegion = params.region || "all";
  const activeStore = params.store || "all";
  const activeState = params.state || "all";
  const activeSort = ["recent", "margin", "profit"].includes(params.sort || "")
    ? (params.sort as "recent" | "margin" | "profit")
    : "recent";
  const rawSearch = (params.q || "").trim();
  const search = rawSearch.toLowerCase();

  const visibleOffers = classified.filter((offer) => {
    if (activeCategory !== "all" && offer.category !== activeCategory) return false;
    if (activeRegion !== "all" && offer.region?.key !== activeRegion) return false;
    if (activeStore !== "all" && offer.source_store !== activeStore) return false;
    if (activeState === "mapped" && !offer.product_id) return false;
    if (activeState === "unmapped" && offer.product_id) return false;
    if (search && !offer.source_title.toLowerCase().includes(search)) return false;
    return true;
  });

  const quoteFor = (offer: (typeof visibleOffers)[number]) => {
    const cost = Number(offer.price_micros);
    const listed = offer.retail_micros ? Number(offer.retail_micros) : 0;
    const retail =
      listed > 0 ? listed : suggestRetailPrice(cost, targetMarginBps);
    const margin = retail > 0 ? ((retail - cost) / retail) * 100 : null;
    return { cost, listed, retail, margin, profit: retail > 0 ? retail - cost : 0 };
  };

  const margins = visibleOffers
    .map((offer) => quoteFor(offer).margin)
    .filter((value): value is number => value !== null);
  const averageMargin =
    margins.length > 0 ? margins.reduce((sum, value) => sum + value, 0) / margins.length : 0;

  const sortedOffers = [...visibleOffers].sort((a, b) => {
    if (activeSort === "profit") return quoteFor(b).profit - quoteFor(a).profit;
    if (activeSort === "margin") {
      return (quoteFor(b).margin ?? -1) - (quoteFor(a).margin ?? -1);
    }
    return 0;
  });

  const importable = sortedOffers
    .filter(
      (offer) =>
        !offer.product_id &&
        offer.import_status !== "queued" &&
        offer.import_status !== "running",
    )
    .slice(0, 20);
  const importPending = Number(stats?.import_pending || 0);
  const trackedJob =
    params.job &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.job)
      ? params.job
      : null;

  const importNotice = (() => {
    if (!params.import) return null;
    switch (params.import) {
      case "queued":
        return "已开始生成草稿，本页会自动刷新；完成后直接打开商品审核页。";
      case "batch_queued":
        return `已排队 ${params.queued || 0} 条，后台生成中；本页会自动刷新。`;
      case "batch_partial":
        return `已排队 ${params.queued || 0} 条，本次生成 ${params.processed || 0} 条草稿；其余点「处理队列」继续。`;
      case "queue_started":
        return "已开始处理排队任务，本页会自动刷新。";
      case "queue_run":
        return `本次处理了 ${params.processed || 0} 条排队任务。`;
      case "batch_unconfirmed":
        return "批量生成前请勾选确认。";
      case "nothing_queued":
        return "这次没有需要生成草稿的货源，可能已被其他人处理。";
      case "timeout":
        return "后台仍在处理，可稍后刷新本页查看结果。";
      case "failed":
        return params.reason
          ? `生成失败：${params.reason}`
          : "生成失败，请点「打开」核对货源页后手动建草稿。";
      case "queue_failed":
        return "无法创建上架任务，请稍后重试。";
      case "offer_not_found":
      case "missing_offer":
        return "找不到这条货源，可能已经下架。";
      default:
        return "上架任务已结束，请查看商品状态。";
    }
  })();

  const hrefFor = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = {
      cat: activeCategory === "all" ? undefined : activeCategory,
      region: activeRegion === "all" ? undefined : activeRegion,
      store: activeStore === "all" ? undefined : activeStore,
      state: activeState === "all" ? undefined : activeState,
      sort: activeSort === "recent" ? undefined : activeSort,
      q: rawSearch || undefined,
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/admin/shop/sources?${qs}` : "/admin/shop/sources";
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>货源状态</h1>
          <p>aibijia 公开数据，每小时同步一次。只同步目录、价格、库存和链接。</p>
        </div>
        <form action={adminSyncShopAction}>
          <SubmitButton className="btn btn-dark btn-sm" pendingText="同步中…">
            <RefreshCw size={14} /> 立即同步
          </SubmitButton>
        </form>
      </div>

      {importNotice ? (
        <div className={`shop-import-banner is-${params.import}`}>{importNotice}</div>
      ) : null}
      {params.saved === "1" ? (
        <div className="notice notice-green">货源设置已保存，下次同步生效。</div>
      ) : null}
      {params.error ? <div className="notice notice-red">{params.error}</div> : null}
      <ImportJobWatcher jobId={trackedJob} pending={importPending} />

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
        <div className="stat-card">
          <div className="stat-label">平均毛利率</div>
          <div className="stat-value">{averageMargin.toFixed(1)}%</div>
          <div className="stat-foot">当前筛选 {margins.length} 条</div>
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
              <dd>{supplier?.feed_url ? "已配置" : "未配置"}</dd>
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
            <p className="shop-form-error mt-16">{redactSource(supplier.last_error)}</p>
          ) : null}
        </div>
      </section>

      <section className="panel mt-16">
        <div className="panel-head">
          <div>
            <h2>货源设置</h2>
            <p>数据源地址与目标毛利率；URL 留空表示回退到 .env 默认值。</p>
          </div>
        </div>
        <div className="panel-body">
          <form action={adminSaveShopSourceSettingsAction} className="form-stack">
            <div className="field">
              <label htmlFor="shop-feed-url">数据源 URL</label>
              <input
                id="shop-feed-url"
                className="input mono"
                name="feedUrl"
                type="url"
                defaultValue={sourceSettings.feedUrl}
                placeholder={config.shopFeedUrl}
                autoComplete="off"
                spellCheck={false}
              />
              <small className="hint">Aibijia 格式的 products.json 地址。</small>
            </div>
            <div className="field">
              <label htmlFor="shop-feed-meta-url">数据源 Meta URL</label>
              <input
                id="shop-feed-meta-url"
                className="input mono"
                name="feedMetaUrl"
                type="url"
                defaultValue={sourceSettings.feedMetaUrl}
                placeholder={config.shopFeedMetaUrl}
                autoComplete="off"
                spellCheck={false}
              />
              <small className="hint">meta.json 地址，用于完整性校验。</small>
            </div>
            <div className="field">
              <label htmlFor="shop-target-margin">目标毛利率（%）</label>
              <input
                id="shop-target-margin"
                className="input"
                name="targetMarginPercent"
                type="number"
                min="0"
                max="90"
                step="0.1"
                defaultValue={(targetMarginBps / 100).toString()}
              />
              <small className="hint">
                上架定价使用：售价 ≈ 成本 × (1 + 毛利率)。默认 30%。
              </small>
            </div>
            <div className="form-actions">
              <SubmitButton className="btn btn-dark btn-sm" pendingText="保存中…">
                保存货源设置
              </SubmitButton>
            </div>
          </form>
        </div>
      </section>

      <section className="panel mt-16">
        <div className="panel-head">
          <div>
            <h2>货源分类</h2>
            <p>按标题关键词归类，仅用于浏览和筛选，不改动同步数据。</p>
          </div>
          <span className="badge">
            共 {classified.length} 条 · 当前 {visibleOffers.length} 条
          </span>
        </div>
        <div className="panel-body">
          <div className="offer-filters">
            <div className="offer-filter-row">
              <span className="offer-filter-label">类型</span>
              <Link
                className={`offer-chip${activeCategory === "all" ? " is-active" : ""}`}
                href={hrefFor({ cat: undefined })}
              >
                全部 <em>{classified.length}</em>
              </Link>
              {OFFER_CATEGORIES.map((item) => (
                <Link
                  key={item.key}
                  className={`offer-chip${activeCategory === item.key ? " is-active" : ""}`}
                  href={hrefFor({ cat: item.key })}
                  title={item.hint}
                >
                  {item.label} <em>{categoryCounts.get(item.key) ?? 0}</em>
                </Link>
              ))}
            </div>
            <div className="offer-filter-row">
              <span className="offer-filter-label">地区</span>
              <Link
                className={`offer-chip${activeRegion === "all" ? " is-active" : ""}`}
                href={hrefFor({ region: undefined })}
              >
                全部
              </Link>
              {[...regionCounts.entries()].map(([key, count]) => (
                <Link
                  key={key}
                  className={`offer-chip${activeRegion === key ? " is-active" : ""}`}
                  href={hrefFor({ region: key })}
                >
                  {classified.find((offer) => offer.region?.key === key)?.region?.label ?? key}{" "}
                  <em>{count}</em>
                </Link>
              ))}
            </div>
            <div className="offer-filter-row">
              <span className="offer-filter-label">店铺</span>
              <Link
                className={`offer-chip${activeStore === "all" ? " is-active" : ""}`}
                href={hrefFor({ store: undefined })}
              >
                全部
              </Link>
              {storeResult.rows.map((store) => (
                <Link
                  key={store.source_store || "-"}
                  className={`offer-chip${activeStore === store.source_store ? " is-active" : ""}`}
                  href={hrefFor({ store: store.source_store })}
                >
                  {store.source_store || "—"} <em>{store.total}</em>
                </Link>
              ))}
            </div>
            <div className="offer-filter-row">
              <span className="offer-filter-label">排序</span>
              {(
                [
                  ["recent", "最近出现"],
                  ["margin", "毛利率"],
                  ["profit", "毛利额"],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  className={`offer-chip${activeSort === key ? " is-active" : ""}`}
                  href={hrefFor({ sort: key === "recent" ? undefined : key })}
                >
                  {label}
                </Link>
              ))}
            </div>
            <div className="offer-filter-row">
              <span className="offer-filter-label">状态</span>
              <Link
                className={`offer-chip${activeState === "all" ? " is-active" : ""}`}
                href={hrefFor({ state: undefined })}
              >
                全部
              </Link>
              <Link
                className={`offer-chip${activeState === "unmapped" ? " is-active" : ""}`}
                href={hrefFor({ state: "unmapped" })}
              >
                未上架 <em>{classified.filter((offer) => !offer.product_id).length}</em>
              </Link>
              <Link
                className={`offer-chip${activeState === "mapped" ? " is-active" : ""}`}
                href={hrefFor({ state: "mapped" })}
              >
                已上架 <em>{classified.filter((offer) => offer.product_id).length}</em>
              </Link>
            </div>
            <form className="offer-filter-search" action="/admin/shop/sources" method="get">
              {activeCategory !== "all" ? <input type="hidden" name="cat" value={activeCategory} /> : null}
              {activeRegion !== "all" ? <input type="hidden" name="region" value={activeRegion} /> : null}
              {activeStore !== "all" ? <input type="hidden" name="store" value={activeStore} /> : null}
              {activeState !== "all" ? <input type="hidden" name="state" value={activeState} /> : null}
              <input
                type="search"
                name="q"
                defaultValue={params.q || ""}
                placeholder="搜索货源标题"
              />
              <button className="btn btn-ghost btn-sm" type="submit">
                搜索
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="panel mt-16">
        <div className="panel-head">
          <div>
            <h2>AI 上架</h2>
            <p>生成草稿商品，不会直接发布；仍需在商品页逐项审核并确认合规。</p>
          </div>
          <span className="badge">队列 {importPending}</span>
        </div>
        <div className="panel-body shop-import-actions">
          <form action={adminBulkShopOfferImportAction} className="shop-import-batch">
            <input type="hidden" name="offerIds" value={importable.map((offer) => offer.id).join(",")} />
            <label>
              <input type="checkbox" name="confirm" />
              我确认按当前筛选批量生成草稿（本次 {importable.length} 条，单次最多 20 条）
            </label>
            <SubmitButton
              className="btn btn-dark btn-sm"
              pendingText="排队中…"
              disabled={importable.length === 0}
            >
              批量 AI 上架
            </SubmitButton>
          </form>
          {importPending > 0 ? (
            <form action={adminRunShopImportQueueAction}>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="处理中…">
                处理队列
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </section>

      <section className="panel mt-16">
        <div className="panel-head">
          <div>
            <h2>货源列表</h2>
          </div>
          <span className="badge">按分类筛选后显示</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>原始标题（内部）</th>
                <th>类型</th>
                <th>地区</th>
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
              {sortedOffers.map((offer) => {
                const { cost, listed, retail, margin } = quoteFor(offer);
                return (
                  <tr key={offer.id}>
                    <td className="shop-offer-title">{offer.source_title}</td>
                    <td className="nowrap">
                      <span className="badge">{OFFER_CATEGORY_LABEL[offer.category]}</span>
                    </td>
                    <td className="nowrap muted">{offer.region?.label ?? "—"}</td>
                    <td className="nowrap">{offer.source_store}</td>
                    <td className="nowrap">{formatCny(cost)}</td>
                    <td className="nowrap">
                      <span className={`badge ${OFFER_BADGE_CLASS[offer.availability] || ""}`}>
                        {offerAvailabilityLabel(offer.availability)}
                      </span>
                    </td>
                    <td className="nowrap">
                      {offer.product_id ? (
                        <>
                          <Link href={`/admin/shop/products/${offer.product_id}`}>
                            {offer.product_name}
                          </Link>
                          {offer.product_status === "draft" ? (
                            <span className="badge badge-yellow"> 待审核</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">未上架到小店</span>
                      )}
                    </td>
                    <td className="nowrap">
                      {retail > 0 ? (
                        <>
                          {listed > 0 ? null : <span className="muted">建议 </span>}
                          {formatCny(retail)}
                          {margin !== null ? (
                            <span className={margin < 15 ? "text-red" : "muted"}>
                              {" "}
                              {margin.toFixed(1)}%
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="nowrap muted">{formatDateTime(offer.last_seen_at)}</td>
                    <td className="text-right">
                      <div className="shop-inline-actions">
                        {!offer.product_id ? (
                          <>
                            {offer.import_status === "queued" ||
                            offer.import_status === "running" ? (
                              <span
                                className="badge badge-yellow"
                                title={offer.import_error || undefined}
                              >
                                AI 生成中
                              </span>
                            ) : (
                              <form action={adminStartShopOfferImportAction}>
                                <input type="hidden" name="offerId" value={offer.id} />
                                <SubmitButton
                                  className="btn btn-dark btn-sm"
                                  pendingText="排队中…"
                                >
                                  AI 上架
                                </SubmitButton>
                              </form>
                            )}
                            <form action={adminCreateShopProductFromOfferAction}>
                              <input type="hidden" name="offerId" value={offer.id} />
                              <SubmitButton
                                className="btn btn-ghost btn-sm"
                                pendingText="创建中…"
                              >
                                手动建草稿
                              </SubmitButton>
                            </form>
                          </>
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
          {visibleOffers.length === 0 ? (
            <p className="offer-empty">没有符合条件的货源，清空筛选再看看。</p>
          ) : null}
        </div>
      </section>
    </>
  );
}
