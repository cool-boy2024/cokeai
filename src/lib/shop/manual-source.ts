import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { withTransaction } from "@/lib/db";
import { parseYuanMicros, validOrderId } from "@/lib/payments/validation";

type SourceAvailability = "in_stock" | "low_stock";
type SourceScope = "order" | "product";

export type ManualShopSourceInput = {
  orderId: string;
  adminId: string;
  sourceStore: string;
  sourceTitle: string;
  sourceUrl: string;
  costYuan: string;
  availability: string;
  scope: string;
};

export function validateManualShopSource(input: ManualShopSourceInput) {
  if (!validOrderId(input.orderId)) throw new Error("订单编号无效");
  const sourceStore = input.sourceStore.trim();
  const sourceTitle = input.sourceTitle.trim();
  const sourceUrl = input.sourceUrl.trim();
  if (!sourceStore || sourceStore.length > 120) throw new Error("供货商名称须为 1–120 字");
  if (!sourceTitle || sourceTitle.length > 300) throw new Error("货源标题须为 1–300 字");
  if (sourceUrl.length > 2000) throw new Error("采购链接过长");
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error();
      }
    } catch {
      throw new Error("采购链接须为不含账号密码的 http(s) 地址");
    }
  }
  const costMicros = parseYuanMicros(input.costYuan);
  if (!["in_stock", "low_stock"].includes(input.availability)) {
    throw new Error("只能添加有货或库存紧张的货源");
  }
  if (input.scope !== "order" && input.scope !== "product") {
    throw new Error("请选择货源使用范围");
  }
  return {
    sourceStore,
    sourceTitle,
    sourceUrl,
    costMicros,
    availability: input.availability as SourceAvailability,
    scope: input.scope as SourceScope,
  };
}

/** Attach a manually entered offer to one order, optionally also to its SKU. */
export async function addManualShopSource(
  input: ManualShopSourceInput,
): Promise<{ productId: string; productSlug: string; scope: SourceScope }> {
  const source = validateManualShopSource(input);
  return withTransaction(async (client) => {
    const orderResult = await client.query<{ status: string }>(
      `SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new Error("订单不存在");
    if (!["pending_payment", "paid", "procuring"].includes(order.status)) {
      throw new Error("当前订单不能添加货源");
    }

    const itemResult = await client.query<{
      id: string;
      product_id: string | null;
      product_slug: string;
      variant_id: string | null;
      qty: number;
      supplier_offer_id: string | null;
      procurement_status: string;
    }>(
      `SELECT id, product_id, product_slug, variant_id, qty, supplier_offer_id, procurement_status
         FROM shop_order_items WHERE order_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [input.orderId],
    );
    const item = itemResult.rows[0];
    if (!item || !item.product_id) throw new Error("订单商品不存在");
    if (!["pending", "to_buy", "bought"].includes(item.procurement_status)) {
      throw new Error("该订单当前采购状态不能添加货源");
    }
    if (item.supplier_offer_id) {
      const snapshot = await client.query<{ entered_for_order: string | null }>(
        `SELECT raw->>'entered_for_order' AS entered_for_order FROM shop_offers WHERE id = $1`,
        [item.supplier_offer_id],
      );
      if (snapshot.rows[0]?.entered_for_order === input.orderId || item.procurement_status === "bought") {
        throw new Error("该订单已有货源，请刷新后查看");
      }
    }
    // A checkout snapshot can outlive its product binding. Before purchase,
    // replace that stale snapshot only when no current active source exists.
    if (item.procurement_status !== "bought") {
      const current = await client.query<{ id: string }>(
        `SELECT id FROM shop_product_sources
          WHERE product_id = $1 AND active = TRUE
            AND (variant_id = $2::uuid OR variant_id IS NULL)
          LIMIT 1`,
        [item.product_id, item.variant_id],
      );
      if (current.rows.length > 0) throw new Error("商品规格已有可用货源，请刷新后查看");
    }

    if (source.scope === "product") {
      const productResult = await client.query<{ price_micros: string; status: string }>(
        `SELECT price_micros, status FROM shop_products WHERE id = $1 FOR UPDATE`,
        [item.product_id],
      );
      const product = productResult.rows[0];
      if (!product || product.status === "archived") throw new Error("商品已归档，不能绑定货源");
      const variant = item.variant_id
        ? (
            await client.query<{ price_micros: string }>(
              `SELECT price_micros FROM shop_product_variants
                WHERE id = $1 AND product_id = $2 FOR UPDATE`,
              [item.variant_id, item.product_id],
            )
          ).rows[0]
        : null;
      if (item.variant_id && !variant) throw new Error("订单规格已不存在，不能绑定到商品");
      const retailMicros = BigInt(variant?.price_micros ?? product.price_micros);
      const minMarginBps = BigInt(Math.max(0, Math.min(9_999, config.shopMinMarginBps)));
      if (retailMicros <= 0n || source.costMicros * 10_000n > retailMicros * (10_000n - minMarginBps)) {
        throw new Error("当前售价不足以覆盖货源成本和最低毛利；请选仅用于本单或先调整售价");
      }
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM shop_product_sources
          WHERE product_id = $1 AND active = TRUE
            AND (variant_id = $2::uuid OR variant_id IS NULL)
          LIMIT 1`,
        [item.product_id, item.variant_id],
      );
      if (existing.rows.length > 0) throw new Error("商品规格已有可用货源，请刷新后查看");
    }

    // Feed sync only selects the aibijia supplier. Keep manual offers under a
    // separate supplier so an hourly feed run never marks them missing.
    await client.query("SELECT pg_advisory_xact_lock(18465, 1)");
    const supplierResult = await client.query<{ id: string }>(
      `SELECT id FROM shop_suppliers
        WHERE kind = 'manual' AND name = '运营手动录入'
        ORDER BY created_at LIMIT 1`,
    );
    let supplierId = supplierResult.rows[0]?.id;
    if (!supplierId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO shop_suppliers (name, kind)
         VALUES ('运营手动录入', 'manual') RETURNING id`,
      );
      supplierId = inserted.rows[0].id;
    }

    const offerResult = await client.query<{ id: string }>(
      `INSERT INTO shop_offers
         (supplier_id, external_key, source_store, source_title, price_micros,
          availability, url, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        supplierId,
        `manual:${randomUUID()}`,
        source.sourceStore,
        source.sourceTitle,
        source.costMicros.toString(),
        source.availability,
        source.sourceUrl,
        JSON.stringify({ origin: "admin_order", scope: source.scope, entered_for_order: input.orderId }),
      ],
    );
    const offerId = offerResult.rows[0].id;
    await client.query(
      `UPDATE shop_order_items
          SET supplier_offer_id = $2,
              supplier_title_snapshot = $3,
              supplier_cost_micros = $4,
              updated_at = now()
        WHERE id = $1`,
      [item.id, offerId, source.sourceTitle, (source.costMicros * BigInt(item.qty)).toString()],
    );

    if (source.scope === "product") {
      await client.query(
        `INSERT INTO shop_product_sources
           (product_id, offer_id, variant_id, role, active,
            supplier_cost_micros, supplier_availability, last_synced_at)
         VALUES ($1, $2, $3, 'primary', TRUE, $4, $5, now())`,
        [item.product_id, offerId, item.variant_id, source.costMicros.toString(), source.availability],
      );
    }

    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'source_added', $3)`,
      [
        input.orderId,
        input.adminId,
        source.scope === "product" ? "运营已录入货源并绑定当前商品规格" : "运营已录入本单货源",
      ],
    );
    return { productId: item.product_id, productSlug: item.product_slug, scope: source.scope };
  });
}
