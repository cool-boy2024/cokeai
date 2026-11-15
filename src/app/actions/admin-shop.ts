"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, withTransaction } from "@/lib/db";
import { autoRetailPrice } from "@/lib/shop/auto-pricing";
import { SHOP_PRODUCT_CATEGORIES } from "@/lib/shop/categories";
import { createImportJob, drainQueuedJobs, runImportJob } from "@/lib/shop/import";
import {
  deliverShopItem,
  markShopItemOutOfStock,
  markShopOrderPaid,
  refundShopOrder,
  rejectShopManualPaymentClaim,
  requestShopRefund,
  startShopProcurement,
} from "@/lib/shop/orders";
import { syncShopFeed } from "@/lib/shop/sync";
import {
  getShopTargetMarginBps,
  saveShopSourceSettings,
  saveShopTargetMarginBps,
} from "@/lib/shop/settings";
import { parseYuanMicros, receiptReference } from "@/lib/payments/validation";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

export async function adminSyncShopAction(): Promise<void> {
  await requireAdmin();
  await syncShopFeed({ force: true }).catch((error) => {
    console.error("[shop] manual sync failed", error);
  });
  revalidatePath("/admin/shop");
  revalidatePath("/admin/shop/sources");
  revalidatePath("/shop");
}

/**
 * Saves the supplier feed URL (and meta URL) plus the shop target margin from
 * the sources page. URLs may be left empty to fall back to the .env default.
 */
export async function adminSaveShopSourceSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const feedUrl = text(formData, "feedUrl");
  const feedMetaUrl = text(formData, "feedMetaUrl");
  const marginPercent = Number(formData.get("targetMarginPercent") || "");

  const validateHttpUrl = (raw: string, label: string): string | null => {
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      return raw;
    } catch {
      throw new Error(`${label}不是合法的 http(s) 地址`);
    }
  };

  try {
    const feed = validateHttpUrl(feedUrl, "数据源 URL");
    const meta = validateHttpUrl(feedMetaUrl, "数据源 Meta URL");
    if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 90) {
      throw new Error("目标毛利率需在 0–90% 之间");
    }
    await saveShopSourceSettings({ feedUrl: feed || "", feedMetaUrl: meta || "" });
    await saveShopTargetMarginBps(Math.round(marginPercent * 100), admin.id);
  } catch (error) {
    redirect(
      `/admin/shop/sources?error=${encodeURIComponent(
        error instanceof Error ? error.message : "保存失败",
      )}`,
    );
  }
  revalidatePath("/admin/shop/sources");
  revalidatePath("/shop");
  redirect("/admin/shop/sources?saved=1");
}

export async function adminMarkShopPaidAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderNo = text(formData, "orderNo");
  const note = text(formData, "note") || "运营确认到账";
  try {
    if (formData.get("checked") !== "on") throw new Error("请先核实真实到账");
    const order = (await query<{ payment_provider: string }>("SELECT payment_provider FROM shop_orders WHERE order_no=$1", [orderNo])).rows[0];
    if (!order || !["manual", "alipay_manual"].includes(order.payment_provider)) throw new Error("自动收款渠道不能手动标记到账");
    await markShopOrderPaid({
      orderNo,
      provider: order.payment_provider as "manual" | "alipay_manual",
      providerRef: receiptReference(text(formData,"receiptRef")),
      paidAmountMicros: Number(parseYuanMicros(text(formData,"amountYuan"))),
      adminId: admin.id,
      note,
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${text(formData, "orderId")}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "确认失败",
      )}`,
    );
  }
  revalidatePath("/admin/shop/orders");
  revalidatePath(`/admin/shop/orders/${text(formData, "orderId")}`);
  redirect(`/admin/shop/orders/${text(formData, "orderId")}?saved=1`);
}

export async function adminRejectShopPaymentClaimAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  try {
    await rejectShopManualPaymentClaim({
      orderId,
      adminId: admin.id,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "打回失败",
      )}`,
    );
  }
  revalidatePath(`/admin/shop/orders/${orderId}`);
  revalidatePath("/shop/checkout/[orderNo]", "page");
  redirect(`/admin/shop/orders/${orderId}?saved=1`);
}

export async function adminStartProcurementAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  try {
    await startShopProcurement({
      orderId,
      adminId: admin.id,
      supplierOrderRef: text(formData, "supplierOrderRef"),
      note: text(formData, "note"),
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "操作失败",
      )}`,
    );
  }
  revalidatePath(`/admin/shop/orders/${orderId}`);
  redirect(`/admin/shop/orders/${orderId}?saved=1`);
}

export async function adminDeliverShopAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  const kind = text(formData, "kind") as "account" | "code" | "manual_note";
  let payload: Record<string, string>;
  if (kind === "account") {
    payload = {
      账号: text(formData, "account"),
      密码: text(formData, "password"),
      两步验证: text(formData, "twoFactor"),
      备注: text(formData, "payloadNote"),
    };
  } else if (kind === "code") {
    payload = {
      卡密: text(formData, "code"),
      兑换说明: text(formData, "codeInstruction"),
    };
  } else {
    payload = { 交付说明: text(formData, "manualNote") };
  }
  Object.keys(payload).forEach((key) => {
    if (!payload[key]) delete payload[key];
  });
  if (Object.keys(payload).length === 0) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent("请先填写交付内容")}`,
    );
  }

  try {
    await deliverShopItem({
      orderId,
      adminId: admin.id,
      kind,
      payload,
      note: text(formData, "note"),
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "交付失败",
      )}`,
    );
  }
  revalidatePath(`/admin/shop/orders/${orderId}`);
  redirect(`/admin/shop/orders/${orderId}?saved=1`);
}

export async function adminOutOfStockShopAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  try {
    await markShopItemOutOfStock({
      orderId,
      adminId: admin.id,
      reason: text(formData, "reason") || "供货商缺货",
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "操作失败",
      )}`,
    );
  }
  revalidatePath(`/admin/shop/orders/${orderId}`);
  redirect(`/admin/shop/orders/${orderId}?saved=1`);
}

export async function adminRequestShopRefundAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  try {
    await requestShopRefund({
      orderId,
      adminId: admin.id,
      reason: text(formData, "reason") || "协商退款",
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "转退款失败",
      )}`,
    );
  }
  revalidatePath(`/admin/shop/orders/${orderId}`);
  redirect(`/admin/shop/orders/${orderId}?saved=1`);
}

export async function adminRefundShopAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  const amountYuan = Number(formData.get("amount") || 0);
  const customerAccount = text(formData, "customerAccount");
  try {
    await refundShopOrder({
      orderId,
      adminId: admin.id,
      amountMicros: Math.round(amountYuan * 1_000_000),
      reason: [text(formData, "reason") || "运营退款", customerAccount ? `收款账户：${customerAccount}` : ""]
        .filter(Boolean)
        .join("；"),
      providerRef: text(formData, "providerRef"),
    });
  } catch (error) {
    redirect(
      `/admin/shop/orders/${orderId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "退款失败",
      )}`,
    );
  }
  revalidatePath(`/admin/shop/orders/${orderId}`);
  redirect(`/admin/shop/orders/${orderId}?saved=1`);
}

export async function adminClearPricingReviewAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const productId = text(formData, "productId");
  const priceYuan = Number(formData.get("price") || 0);
  const priceMicros = Math.round(priceYuan * 1_000_000);
  await query(
    `UPDATE shop_products
        SET price_micros = CASE WHEN $2 > 0 THEN $2 ELSE price_micros END,
            -- Confirming a price after a margin circuit-breaker is a decision
            -- even when the number is unchanged, so lock it either way.
            price_locked = CASE WHEN $2 > 0 THEN TRUE ELSE price_locked END,
            price_locked_at = CASE WHEN $2 > 0 THEN now() ELSE price_locked_at END,
            pricing_review_required = FALSE,
            availability_reason = NULL,
            updated_at = now()
      WHERE id = $1`,
    [productId, priceMicros],
  );
  revalidatePath("/admin/shop/products");
  revalidatePath(`/admin/shop/products/${productId}`);
  revalidatePath("/shop");
  redirect(`/admin/shop/products/${productId}?saved=1`);
}

export async function adminCreateShopProductFromOfferAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const offerId = text(formData, "offerId");
  const offer = await query<{
    id: string;
    external_key: string;
    source_title: string;
    source_store: string;
    supplier_product_slug: string;
    price_micros: string;
    availability: string;
  }>(
    `SELECT id, external_key, source_title, source_store, supplier_product_slug,
            price_micros, availability
       FROM shop_offers WHERE id = $1 LIMIT 1`,
    [offerId],
  );
  const row = offer.rows[0];
  if (!row) redirect("/admin/shop/sources?error=offer_not_found");

  const brand = ["chatgpt", "claude", "gemini", "grok"].includes(row.supplier_product_slug)
    ? row.supplier_product_slug
    : "other";
  const slug = `draft-${row.external_key.slice(0, 12)}`;
  const inserted = await query<{ id: string }>(
    `INSERT INTO shop_products
       (slug, brand, category, product_type, name, status, availability,
        price_micros, copy_ready)
     VALUES ($1, $2, 'subscription', 'subscription', $3, 'draft', 'out_of_stock', 0, FALSE)
     ON CONFLICT (slug) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [slug, brand, row.source_title.slice(0, 200)],
  );
  const productId = inserted.rows[0].id;

  await query(
    `INSERT INTO shop_product_sources
       (product_id, offer_id, role, active, supplier_cost_micros,
        supplier_availability, last_synced_at)
     VALUES ($1, $2, 'primary', TRUE, $3, $4, now())
     ON CONFLICT (product_id, offer_id) DO UPDATE SET
       active = TRUE, supplier_cost_micros = EXCLUDED.supplier_cost_micros,
       supplier_availability = EXCLUDED.supplier_availability,
       last_synced_at = now()`,
    [productId, row.id, row.price_micros, row.availability],
  );

  revalidatePath("/admin/shop/products");
  redirect(`/admin/shop/products/${productId}?created=1`);
}

/**
 * "AI 上架": turn one supplier offer into a draft product.
 *
 * The draft is never published here. The click only enqueues the job and
 * redirects; scraping the supplier page (and the optional model call) happens
 * in an `after()` callback so the button feels instant. When n8n is configured
 * it gets the job first; if that handoff fails the same callback runs it
 * locally. The product editor is opened by the status watcher once a draft
 * exists, where a human still has to acknowledge compliance.
 */
export async function adminStartShopOfferImportAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const offerId = text(formData, "offerId");
  if (!offerId) redirect("/admin/shop/sources?import=missing_offer");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId)) {
    redirect("/admin/shop/sources?import=offer_not_found");
  }

  const offer = await query<{ id: string }>(
    "SELECT id FROM shop_offers WHERE id = $1 LIMIT 1",
    [offerId],
  );
  if (!offer.rows[0]) redirect("/admin/shop/sources?import=offer_not_found");

  let jobId = "";
  try {
    const job = await createImportJob(offerId, admin.id);
    jobId = job.id;
  } catch (error) {
    console.error("[shop] import job enqueue failed", error);
  }
  if (!jobId) redirect("/admin/shop/sources?import=queue_failed");

  after(async () => {
    if (config.shopImportWebhookUrl) {
      await notifyImportWebhook(jobId, offerId);
    }
    // Always attempt locally as well. `runImportJob` claims atomically, so if
    // n8n won the race this is a no-op rather than a duplicate draft. It also
    // covers a webhook that returns 200 but whose workflow then rejects.
    await runImportJob(jobId).catch((error) => {
      console.error("[shop] background import failed", error);
    });
    revalidatePath("/admin/shop/sources");
    revalidatePath("/admin/shop/products");
  });

  revalidatePath("/admin/shop/sources");
  redirect(`/admin/shop/sources?import=queued&job=${encodeURIComponent(jobId)}`);
}

/**
 * The internal secret may only travel over the private Docker network or
 * loopback. If an operator points the import webhook at an external host, the
 * local import path still runs; leaking the secret that protects every internal
 * endpoint is not an acceptable fallback.
 */
function internalWebhookSecret(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    const allowed = ["n8n", "app", "edge", "localhost", "127.0.0.1", "::1"].includes(host);
    if (!allowed) {
      console.warn("[shop] import webhook is external; internal secret not sent", host);
      return undefined;
    }
    return process.env.INTERNAL_API_SECRET || undefined;
  } catch {
    return undefined;
  }
}

async function notifyImportWebhook(jobId: string, offerId: string): Promise<boolean> {
  if (!config.shopImportWebhookUrl) return false;
  const secret = internalWebhookSecret(config.shopImportWebhookUrl);
  try {
    const response = await fetch(config.shopImportWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-internal-secret": secret } : {}),
      },
      body: JSON.stringify({ jobId, offerId }),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch (error) {
    console.error("[shop] n8n webhook failed", error);
    return false;
  }
}

/**
 * Batch version of "AI 上架": queue up to 20 visible offers and return at once.
 * The same `after()` callback notifies n8n and drains a few jobs locally, so a
 * batch click no longer blocks on scraping 20 supplier pages. Drafts still
 * need review before publishing.
 */
export async function adminBulkShopOfferImportAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (formData.get("confirm") !== "on") {
    redirect("/admin/shop/sources?import=batch_unconfirmed");
  }

  const ids = text(formData, "offerIds")
    .split(",")
    .map((value) => value.trim())
    .filter((value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    )
    .slice(0, 20);
  if (ids.length === 0) redirect("/admin/shop/sources?import=missing_offer");

  const eligible = await query<{ id: string }>(
    `SELECT o.id
       FROM shop_offers o
       LEFT JOIN shop_product_sources s ON s.offer_id = o.id AND s.active = TRUE
      WHERE o.id = ANY($1::uuid[])
        AND s.id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM shop_import_jobs j
           WHERE j.offer_id = o.id AND j.status IN ('queued', 'running')
        )`,
    [ids],
  );

  let queued = 0;
  const jobs: { id: string; offerId: string }[] = [];
  for (const row of eligible.rows) {
    try {
      const job = await createImportJob(row.id, admin.id);
      jobs.push({ id: job.id, offerId: row.id });
      queued += 1;
    } catch (error) {
      console.error("[shop] bulk import enqueue failed", error);
    }
  }

  if (jobs.length === 0) {
    redirect("/admin/shop/sources?import=nothing_queued");
  }

  after(async () => {
    if (config.shopImportWebhookUrl) {
      // n8n acknowledges the webhook immediately; failures fall through to the
      // local drain below because those jobs stay queued.
      await Promise.all(
        jobs.map((job) => notifyImportWebhook(job.id, job.offerId)),
      ).catch(() => {});
    }
    await drainQueuedJobs(5).catch((error) => {
      console.error("[shop] background queue drain failed", error);
    });
    revalidatePath("/admin/shop/sources");
    revalidatePath("/admin/shop/products");
  });

  revalidatePath("/admin/shop/sources");
  redirect(`/admin/shop/sources?import=batch_queued&queued=${queued}`);
}

export async function adminRunShopImportQueueAction(): Promise<void> {
  await requireAdmin();
  after(async () => {
    await drainQueuedJobs(5).catch((error) => {
      console.error("[shop] background queue drain failed", error);
    });
    revalidatePath("/admin/shop/sources");
    revalidatePath("/admin/shop/products");
  });
  revalidatePath("/admin/shop/sources");
  redirect("/admin/shop/sources?import=queue_started");
}

export async function adminSaveShopProductAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const productId = text(formData, "productId");
  const name = text(formData, "name");
  const subtitle = text(formData, "subtitle");
  const description = text(formData, "description");
  const includes = text(formData, "includes")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const usage = text(formData, "usage")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const notice = text(formData, "customerNotice");
  const refund = text(formData, "refundPolicy");
  const priceYuan = Number(formData.get("price") || 0);
  const priceMicros = Math.round(priceYuan * 1_000_000);
  const etaMin = Number(formData.get("etaMin") || 0);
  const etaMax = Number(formData.get("etaMax") || 0);
  const warrantyType = text(formData, "warrantyType") || "first_login";
  const warrantyDays = Number(formData.get("warrantyDays") || 0);
  const warrantyNote = text(formData, "warrantyNote");
  const status = text(formData, "status") || "draft";
  const displayCategoryValue = text(formData, "displayCategory");
  // Only canonical labels are stored; anything else means "let the brand
  // decide", so the public rail never receives a supplier's raw category name.
  const displayCategory =
    SHOP_PRODUCT_CATEGORIES.find((item) => item.label === displayCategoryValue)?.label || "";
  const complianceAck = formData.get("complianceAck") === "1";
  // Independent switch: supplier stock or the next sync must not clear it.
  const preorderManual = formData.get("preorderManual") === "1";
  // Curated placement: featured products get the pinned card and the top of
  // the catalog; sort order breaks ties within the same placement.
  const featured = formData.get("featured") === "1";
  const sortOrder = Math.trunc(Number(formData.get("sortOrder") || 0)) || 0;

  const copyReady =
    Boolean(name && subtitle && description) &&
    includes.length > 0 &&
    usage.length > 0 &&
    Boolean(notice) &&
    Boolean(refund) &&
    etaMax > 0;

  // Publishing requires complete copy and a human compliance acknowledgement.
  const finalStatus = status === "active" && (!copyReady || !complianceAck) ? "draft" : status;

  await query(
    `UPDATE shop_products
        SET name = $2, subtitle = $3, description = $4,
            includes = $5::jsonb, usage_notes = $6::jsonb,
            customer_notice = $7, refund_policy = $8,
            price_micros = CASE WHEN $9 > 0 THEN $9 ELSE price_micros END,
            -- An explicit price change is a deliberate decision: keep it
            -- through future supply syncs until the operator resets it.
            price_locked = CASE
              WHEN $9 > 0 AND $9 <> price_micros THEN TRUE
              ELSE price_locked
            END,
            price_locked_at = CASE
              WHEN $9 > 0 AND $9 <> price_micros THEN now()
              ELSE price_locked_at
            END,
            eta_min_minutes = $10, eta_max_minutes = $11,
            warranty_type = $12, warranty_days = $13, warranty_note = $14,
            copy_ready = $15,
            display_category = $19,
            preorder_manual = $20,
            featured = $21,
            sort_order = $22,
            status = $16,
            compliance_ack_at = CASE
              WHEN $16 = 'active' AND $17 = TRUE THEN COALESCE(compliance_ack_at, now())
              ELSE compliance_ack_at
            END,
            compliance_ack_by = CASE
              WHEN $16 = 'active' AND $17 = TRUE THEN COALESCE(compliance_ack_by, $18)
              ELSE compliance_ack_by
            END,
            published_at = CASE
              WHEN $16 = 'active' AND $17 = TRUE THEN COALESCE(published_at, now())
              ELSE published_at
            END,
            updated_at = now()
      WHERE id = $1`,
    [
      productId,
      name,
      subtitle,
      description,
      JSON.stringify(includes),
      JSON.stringify(usage),
      notice,
      refund,
      priceMicros,
      etaMin,
      etaMax,
      warrantyType,
      warrantyDays,
      warrantyNote,
      copyReady,
      finalStatus,
      complianceAck,
      admin.id,
      displayCategory,
      preorderManual,
      featured,
      sortOrder,
    ],
  );
  revalidatePath("/admin/shop/products");
  revalidatePath(`/admin/shop/products/${productId}`);
  revalidatePath("/shop");
  redirect(`/admin/shop/products/${productId}?saved=1`);
}

/**
 * Drop a manual price and go back to the supplier-derived retail price.
 * Uses the current supplier cost so the operator sees the same number the next
 * scheduled sync would have written.
 */
export async function adminResetShopPriceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const productId = text(formData, "productId");
  const exists = await query(`SELECT 1 FROM shop_products WHERE id = $1`, [productId]);
  if (!exists.rowCount) redirect("/admin/shop/products?error=商品不存在");

  const costRow = (
    await query<{ cost: string | number | null }>(
      `SELECT MAX(supplier_cost_micros) AS cost
         FROM shop_product_sources
        WHERE product_id = $1 AND active = TRUE`,
      [productId],
    )
  ).rows[0];
  const cost = Math.max(0, Number(costRow?.cost || 0));
  if (cost <= 0) {
    redirect(
      `/admin/shop/products/${productId}?error=${encodeURIComponent(
        "没有可用的供货商成本，无法恢复自动定价",
      )}`,
    );
  }

  const retail = autoRetailPrice(cost, await getShopTargetMarginBps());
  await query(
    `UPDATE shop_products
        SET price_micros = $2, price_locked = FALSE, price_locked_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [productId, retail],
  );
  revalidatePath("/admin/shop/products");
  revalidatePath(`/admin/shop/products/${productId}`);
  revalidatePath("/shop");
  redirect(`/admin/shop/products/${productId}?saved=1&price=auto`);
}

const VARIANT_AVAILABILITY = new Set([
  "in_stock",
  "low_stock",
  "out_of_stock",
  "paused",
]);
const VARIANT_WARRANTY = new Set(["first_login", "days", "none"]);

type VariantPayload = {
  id?: string;
  label?: string;
  badge?: string;
  price?: number | string;
  warrantyType?: string;
  warrantyDays?: number | string;
  warrantyNote?: string;
  availability?: string;
  preorder?: boolean;
  sortOrder?: number | string;
};

/**
 * Replaces a product's selectable options ("宝贝类型") in one transaction.
 * Rows keep their id when edited so variant-bound supplier sources and past
 * order snapshots keep pointing at the same option; removed rows are only
 * deactivated, never deleted.
 */
export async function adminSaveShopVariantsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const productId = text(formData, "productId");
  const exists = await query(`SELECT 1 FROM shop_products WHERE id = $1`, [productId]);
  if (!exists.rowCount) redirect("/admin/shop/products?error=商品不存在");

  let payload: VariantPayload[] = [];
  try {
    const parsed = JSON.parse(text(formData, "variants") || "[]");
    if (!Array.isArray(parsed)) throw new Error("not an array");
    payload = parsed;
  } catch {
    redirect(
      `/admin/shop/products/${productId}?error=${encodeURIComponent("规格数据格式错误，请刷新后重试")}`,
    );
  }
  if (payload.length > 30) {
    redirect(
      `/admin/shop/products/${productId}?error=${encodeURIComponent("单个商品最多 30 个规格")}`,
    );
  }

  const clean = payload.map((item, index) => {
    const label = String(item.label || "").trim().slice(0, 80);
    const priceMicros = Math.round(Number(item.price || 0) * 1_000_000);
    const availability = VARIANT_AVAILABILITY.has(String(item.availability))
      ? String(item.availability)
      : "in_stock";
    const warrantyType = VARIANT_WARRANTY.has(String(item.warrantyType))
      ? String(item.warrantyType)
      : "first_login";
    return {
      id: item.id ? String(item.id) : null,
      label,
      badge: String(item.badge || "").trim().slice(0, 40),
      priceMicros,
      warrantyType,
      warrantyDays: Math.max(0, Math.trunc(Number(item.warrantyDays || 0)) || 0),
      warrantyNote: String(item.warrantyNote || "").trim().slice(0, 300),
      availability,
      preorder: Boolean(item.preorder),
      sortOrder: Math.trunc(Number(item.sortOrder ?? index)) || 0,
    };
  });
  if (clean.some((item) => !item.label)) {
    redirect(
      `/admin/shop/products/${productId}?error=${encodeURIComponent("每个规格都需要填写名称")}`,
    );
  }
  if (clean.some((item) => item.priceMicros <= 0)) {
    redirect(
      `/admin/shop/products/${productId}?error=${encodeURIComponent("每个规格都需要填写大于 0 的售价")}`,
    );
  }

  await withTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM shop_product_variants WHERE product_id = $1`,
      [productId],
    );
    const existingIds = new Set(existing.rows.map((row) => row.id));
    const keptIds: string[] = [];

    for (const item of clean) {
      const id = item.id && existingIds.has(item.id) ? item.id : null;
      if (id) {
        keptIds.push(id);
        await client.query(
          `UPDATE shop_product_variants
              SET label = $3, badge = $4, price_micros = $5,
                  warranty_type = $6, warranty_days = $7, warranty_note = $8,
                  availability = $9, preorder_manual = $10, sort_order = $11,
                  active = TRUE, updated_at = now()
            WHERE id = $2 AND product_id = $1`,
          [
            productId,
            id,
            item.label,
            item.badge,
            item.priceMicros,
            item.warrantyType,
            item.warrantyDays,
            item.warrantyNote,
            item.availability,
            item.preorder,
            item.sortOrder,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO shop_product_variants
             (product_id, variant_key, label, badge, price_micros,
              warranty_type, warranty_days, warranty_note, availability,
              preorder_manual, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            productId,
            `v${crypto.randomUUID().slice(0, 8)}`,
            item.label,
            item.badge,
            item.priceMicros,
            item.warrantyType,
            item.warrantyDays,
            item.warrantyNote,
            item.availability,
            item.preorder,
            item.sortOrder,
          ],
        );
      }
    }

    await client.query(
      `UPDATE shop_product_variants
          SET active = FALSE, updated_at = now()
        WHERE product_id = $1
          AND NOT (id = ANY($2::uuid[]))
          AND active = TRUE`,
      [productId, keptIds],
    );
  });

  revalidatePath("/admin/shop/products");
  revalidatePath(`/admin/shop/products/${productId}`);
  revalidatePath("/shop");
  redirect(`/admin/shop/products/${productId}?saved=variants`);
}
