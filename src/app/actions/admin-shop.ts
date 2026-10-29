"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  deliverShopItem,
  markShopItemOutOfStock,
  markShopOrderPaid,
  refundShopOrder,
  startShopProcurement,
} from "@/lib/shop/orders";
import { syncShopFeed } from "@/lib/shop/sync";
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

export async function adminRefundShopAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = text(formData, "orderId");
  const amountYuan = Number(formData.get("amount") || 0);
  try {
    await refundShopOrder({
      orderId,
      adminId: admin.id,
      amountMicros: Math.round(amountYuan * 1_000_000),
      reason: text(formData, "reason") || "运营退款",
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
  const complianceAck = formData.get("complianceAck") === "1";

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
            eta_min_minutes = $10, eta_max_minutes = $11,
            warranty_type = $12, warranty_days = $13, warranty_note = $14,
            copy_ready = $15,
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
    ],
  );
  revalidatePath("/admin/shop/products");
  revalidatePath(`/admin/shop/products/${productId}`);
  revalidatePath("/shop");
  redirect(`/admin/shop/products/${productId}?saved=1`);
}
