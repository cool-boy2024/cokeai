import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  adminClearPricingReviewAction,
  adminResetShopPriceAction,
  adminSaveShopProductAction,
} from "@/app/actions/admin-shop";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { autoRetailPrice } from "@/lib/shop/auto-pricing";
import { getAdminProduct, loadProductVariants } from "@/lib/shop/catalog";
import { VariantEditor } from "@/components/shop/admin/VariantEditor";
import {
  normalizeDisplayCategory,
  SHOP_PRODUCT_CATEGORIES,
} from "@/lib/shop/categories";
import { getShopTargetMarginBps } from "@/lib/shop/settings";
import { offerAvailabilityLabel, validateProductCopy } from "@/lib/shop/copy";
import { PREORDER_MARKER } from "@/lib/shop/preorder";

export const metadata: Metadata = { title: "编辑小店商品" };
export const dynamic = "force-dynamic";

export default async function AdminShopProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const flags = await searchParams;
  const product = await getAdminProduct(id);
  if (!product) notFound();

  const sources = await query<{
    id: string;
    role: string;
    active: boolean;
    supplier_cost_micros: string;
    supplier_availability: string;
    last_synced_at: string | null;
    source_title: string;
    source_store: string;
    url: string;
  }>(
    `SELECT s.id, s.role, s.active, s.supplier_cost_micros, s.supplier_availability,
            s.last_synced_at, o.source_title, o.source_store, o.url
       FROM shop_product_sources s
       JOIN shop_offers o ON o.id = s.offer_id
      WHERE s.product_id = $1
      ORDER BY s.role, s.created_at`,
    [product.id],
  );

  const variants = (await loadProductVariants([product.id])).get(product.id) || [];
  const missing = validateProductCopy(product);
  const cost = Math.max(
    0,
    ...sources.rows.filter((source) => source.active).map((source) => Number(source.supplier_cost_micros)),
  );
  const margin =
    product.price_micros > 0 && cost > 0
      ? ((product.price_micros - cost) / product.price_micros) * 100
      : null;
  const targetMarginBps = await getShopTargetMarginBps();
  const suggestedPrice = cost > 0 ? autoRetailPrice(cost, targetMarginBps) : 0;

  return (
    <>
      <Link className="shop-back" href="/admin/shop/products">
        <ArrowLeft size={14} /> 小店商品
      </Link>

      <div className="page-head">
        <div>
          <h1>{product.name || "未命名商品"}</h1>
          <p className="mono">{product.slug}</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-light btn-sm" href={`/shop/${product.slug}`} target="_blank">
            查看公开页
          </Link>
        </div>
      </div>

      {flags.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>商品已保存。</div>
        </div>
      ) : null}
      {flags.saved === "variants" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>档位已保存，商品页立即生效。</div>
        </div>
      ) : null}
      {flags.ai === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            AI 已生成草稿，商品仍是「草稿」状态。请逐项核对名称、价格、注意事项与退款说明，
            确认无误后勾选合规确认并改为「上架」。
          </div>
        </div>
      ) : null}
      {flags.existing === "1" ? (
        <div className="notice">
          <AlertTriangle size={16} />
          <div>这条货源已经对应一个商品，已跳到现有商品，请直接审核。</div>
        </div>
      ) : null}
      {flags.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{flags.error}</div>
        </div>
      ) : null}
      {product.pricing_review_required ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>
            毛利熔断：
            {product.availability_reason && product.availability_reason !== PREORDER_MARKER
              ? product.availability_reason
              : "需要确认售价"}
            。商品当前不会出现在公开页。
          </div>
        </div>
      ) : null}

      <div className="shop-admin-detail">
        <form action={adminSaveShopProductAction} className="shop-admin-main">
          <input type="hidden" name="productId" value={product.id} />

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>公开文案</h2>
              </div>
              <span className={`badge ${missing.length === 0 ? "badge-green" : "badge-yellow"}`}>
                {missing.length === 0 ? "文案完整" : `缺少 ${missing.length} 项`}
              </span>
            </div>

            <div className="shop-form-grid">
              <label className="shop-field">
                <span>商品名称</span>
                <input name="name" defaultValue={product.name} maxLength={200} />
              </label>
              <label className="shop-field">
                <span>副标题</span>
                <input name="subtitle" defaultValue={product.subtitle} maxLength={200} />
              </label>
              <label className="shop-field">
                <span>展示分类（/shop 分类轨）</span>
                <select
                  name="displayCategory"
                  defaultValue={
                    product.display_category
                      ? normalizeDisplayCategory(product.display_category)
                      : ""
                  }
                >
                  <option value="">自动（按品牌）</option>
                  {SHOP_PRODUCT_CATEGORIES.map((item) => (
                    <option key={item.slug} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="shop-field">
              <span>商品说明（原样粘贴货源页「商品详情」，换行和缩进会保留）</span>
              <textarea name="description" defaultValue={product.description} rows={12} />
            </label>

            <div className="shop-form-grid">
              <label className="shop-field">
                <span>你将收到（每行一条）</span>
                <textarea name="includes" defaultValue={product.includes.join("\n")} rows={5} />
              </label>
              <label className="shop-field">
                <span>使用说明（每行一条）</span>
                <textarea name="usage" defaultValue={product.usage_notes.join("\n")} rows={5} />
              </label>
            </div>

            <div className="shop-form-grid">
              <label className="shop-field">
                <span>购买须知</span>
                <textarea name="customerNotice" defaultValue={product.customer_notice} rows={4} />
              </label>
              <label className="shop-field">
                <span>售后说明</span>
                <textarea name="refundPolicy" defaultValue={product.refund_policy} rows={4} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>价格与时效</h2>
              </div>
              <span className={`badge ${product.price_locked ? "badge-yellow" : ""}`}>
                {product.price_locked ? "手动售价" : "自动定价"}
              </span>
            </div>
            <div className="shop-form-grid">
              <label className="shop-field">
                <span>售价（元）</span>
                <input
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={(product.price_micros / 1_000_000).toFixed(2)}
                />
              </label>
              <label className="shop-field">
                <span>质保类型</span>
                <select name="warrantyType" defaultValue={product.warranty_type}>
                  <option value="first_login">首登质保</option>
                  <option value="days">按天质保</option>
                  <option value="none">无质保</option>
                </select>
              </label>
              <label className="shop-field">
                <span>质保天数</span>
                <input
                  name="warrantyDays"
                  type="number"
                  min="0"
                  defaultValue={product.warranty_days}
                />
              </label>
              <label className="shop-field">
                <span>最短发货（分钟）</span>
                <input
                  name="etaMin"
                  type="number"
                  min="0"
                  defaultValue={product.eta_min_minutes}
                />
              </label>
              <label className="shop-field">
                <span>最长发货（分钟）</span>
                <input
                  name="etaMax"
                  type="number"
                  min="1"
                  defaultValue={product.eta_max_minutes}
                />
              </label>
              <label className="shop-field">
                <span>状态</span>
                <select name="status" defaultValue={product.status}>
                  <option value="draft">草稿</option>
                  <option value="active">上架</option>
                  <option value="paused">暂停</option>
                  <option value="archived">归档</option>
                </select>
              </label>
              <label className="shop-field">
                <span>排序权重（越小越靠前）</span>
                <input
                  name="sortOrder"
                  type="number"
                  defaultValue={product.sort_order}
                />
              </label>
            </div>

            <label className="shop-compliance">
              <input
                type="checkbox"
                name="lockPrice"
                value="1"
                defaultChecked={product.price_locked}
              />
              <input
                type="hidden"
                name="priceLockInitial"
                value={product.price_locked ? "1" : "0"}
              />
              <span>
                锁定售价：勾选后货源同步只更新成本和文案，不会改动售价；
                取消勾选并保存后，下一次同步会按最新货源成本重新自动定价。
              </span>
            </label>

            <label className="shop-compliance">
              <input
                type="checkbox"
                name="featured"
                value="1"
                defaultChecked={product.featured}
              />
              <span>
                设为主推商品：在 /shop 顶部主推位展示，并在商品列表中置顶。
              </span>
            </label>

            <label className="shop-compliance">
              <input
                type="checkbox"
                name="preorderManual"
                value="1"
                defaultChecked={product.preorder_manual}
              />
              <span>
                按预定单销售（无现货，按预约顺序采购）。勾选后商品页显示「预定」，
                下单前提示发货可能延迟；不受供货商库存和定时同步影响。
                Muse 品牌默认即为预定，无需勾选。
              </span>
            </label>

            <p className="shop-muted">
              {product.price_locked
                ? "当前售价已锁定，货源同步只更新成本，不会覆盖售价。"
                : "当前为自动定价：货源同步会按最新成本重算售价。"}
              手动改动售价并保存会视为你的确认，自动锁定。
            </p>

            <label className="shop-field">
              <span>质保说明（按货源原文，留空则显示上面的质保类型和天数）</span>
              <input name="warrantyNote" defaultValue={product.warranty_note} maxLength={300} />
            </label>

            {missing.length > 0 ? (
              <p className="shop-muted">缺少：{missing.join("、")}。文案不完整时保存为草稿。</p>
            ) : null}

            <label className="shop-compliance">
              <input type="checkbox" name="complianceAck" value="1" />
              <span>
                我确认该商品可合法转售或代充，来源可说明，不销售来源不明或盗取的账号；
                文案中的质保和售后承诺不超过供货商实际承诺。
              </span>
            </label>
            <p className="shop-muted">未勾选合规确认时，即使选择“上架”也会保存为草稿。</p>
          </section>

          <div className="shop-form-actions">
            <button className="btn btn-primary" type="submit">
              保存商品
            </button>
            <span className="shop-muted">
              保存后公开页、结算页、订单页读取同一份文案。
            </span>
          </div>
        </form>

        <aside className="shop-admin-side">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>供货来源</h2>
              </div>
              <span className="badge">{sources.rows.length}</span>
            </div>
            {sources.rows.length === 0 ? (
              <div className="empty">未绑定货源。</div>
            ) : (
              <ul className="shop-source-list">
                {sources.rows.map((source) => (
                  <li key={source.id}>
                    <div>
                      <strong>{source.source_store}</strong>
                      <span className={`badge ${source.active ? "badge-green" : ""}`}>
                        {source.active ? source.role : "停用"}
                      </span>
                    </div>
                    <p>{source.source_title}</p>
                    <small>
                      {formatCny(source.supplier_cost_micros)} ·{" "}
                      {offerAvailabilityLabel(source.supplier_availability)} ·{" "}
                      {source.last_synced_at ? formatDateTime(source.last_synced_at) : "—"}
                    </small>
                    <a href={source.url} target="_blank" rel="noreferrer" className="shop-muted">
                      打开供货商页面
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {margin !== null ? (
              <p className={margin < 15 ? "text-red" : "shop-muted"}>
                最高成本 {formatCny(cost)} · 毛利 {margin.toFixed(1)}%
              </p>
            ) : null}
          </section>

          {product.price_locked ? (
            <section className="panel">
              <h2>售价已锁定</h2>
              <p className="shop-muted">
                定时同步只更新成本和文案，不会覆盖当前售价。
                {suggestedPrice > 0
                  ? `按当前货源成本，自动定价约为 ${formatCny(suggestedPrice)}（目标毛利 ${(targetMarginBps / 100).toFixed(0)}%）。`
                  : ""}
              </p>
              <form action={adminResetShopPriceAction} className="shop-admin-form">
                <input type="hidden" name="productId" value={product.id} />
                <button className="btn btn-light btn-block" type="submit">
                  恢复自动定价
                </button>
              </form>
            </section>
          ) : null}

          {product.pricing_review_required ? (
            <section className="panel">
              <h2>解除毛利熔断</h2>
              <form action={adminClearPricingReviewAction} className="shop-admin-form">
                <input type="hidden" name="productId" value={product.id} />
                <label className="shop-field">
                  <span>确认后的售价（元）</span>
                  <input
                    name="price"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={(product.price_micros / 1_000_000).toFixed(2)}
                  />
                </label>
                <button className="btn btn-dark btn-block" type="submit">
                  确认售价并恢复
                </button>
              </form>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>客户输入</h2>
              </div>
            </div>
            {product.input_fields.length === 0 ? (
              <p className="shop-muted">无需客户提供信息。</p>
            ) : (
              <ul className="shop-source-list">
                {product.input_fields.map((field) => (
                  <li key={field.key}>
                    <strong>{field.label}</strong>
                    <small>
                      {field.required ? "必填" : "选填"} · {field.type}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <p className="shop-muted">输入内容使用 AES-256-GCM 加密，交付后 7 天自动清除。</p>
          </section>
        </aside>
      </div>

      <section className="panel shop-variant-panel">
        <div className="panel-head">
          <div>
            <h2>宝贝类型 / 档位</h2>
            <p className="shop-muted">
              买家在商品页点选档位，价格与质保随之切换；订单会记录所选档位。
            </p>
          </div>
          <span className="badge">{variants.length} 个档位</span>
        </div>
        <VariantEditor
          productId={product.id}
          initialVariants={variants.map((variant) => ({
            id: variant.id,
            label: variant.label,
            badge: variant.badge,
            price_micros: variant.price_micros,
            warranty_type: variant.warranty_type,
            warranty_days: variant.warranty_days,
            warranty_note: variant.warranty_note,
            availability: variant.availability,
            preorder: variant.preorder,
            sort_order: variant.sort_order,
          }))}
        />
      </section>
    </>
  );
}
