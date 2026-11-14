import { randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { getManualAlipaySettings } from "@/lib/payments/settings";
import { receiptReference } from "@/lib/payments/validation";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, toNumber, withTransaction } from "@/lib/db";
import { isPurchasable, type ShopInputField } from "./copy";

export type ShopOrderStatus =
  | "pending_payment"
  | "paid"
  | "procuring"
  | "delivered"
  | "cancelled"
  | "expired"
  | "refund_pending"
  | "refunded";

export type ShopOrderSummary = {
  id: string;
  order_no: string;
  status: ShopOrderStatus;
  amount_micros: number;
  subtotal_micros: number;
  payment_provider: string;
  provider_ref: string | null;
  pay_amount: number | null;
  pay_currency: string | null;
  pay_address: string | null;
  pay_txid: string | null;
  pay_expires_at: string | null;
  expires_at: string;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
  product_slug: string;
  product_name: string;
  brand: string;
  unit_price_micros: number;
  qty: number;
  procurement_status: string;
  delivery_kind: string | null;
  delivered_at_item: string | null;
  customer_input_encrypted: string | null;
  customer_input_purged_at: string | null;
  /** Latest manual Alipay report from the customer, if any. */
  reported_reference: string | null;
  reported_at: string | null;
};

export type ShopOrderDetail = ShopOrderSummary & {
  user_id: string;
  email?: string;
  name?: string;
  customer_note: string;
  admin_note: string;
  supplier_title_snapshot: string;
  supplier_cost_micros: number;
  supplier_offer_id: string | null;
  supplier_order_ref: string | null;
  delivery_note: string;
  revealed_at: string | null;
  reveal_count: number;
  events?: Array<{
    id: string;
    actor_type: string;
    event: string;
    note: string;
    created_at: string;
  }>;
};

const ORDER_SELECT = `
  SELECT o.id, o.order_no, o.status, o.amount_micros, o.subtotal_micros,
         o.payment_provider, o.provider_ref, o.pay_amount, o.pay_currency, o.pay_address,
         o.pay_txid, o.pay_expires_at, o.expires_at, o.created_at, o.paid_at,
         o.delivered_at, o.user_id, o.customer_note, o.admin_note,
         i.product_slug, i.product_name, i.brand, i.unit_price_micros, i.qty,
         i.procurement_status, i.delivery_kind, i.delivered_at AS delivered_at_item,
         i.customer_input_encrypted, i.customer_input_purged_at,
         i.supplier_title_snapshot, i.supplier_cost_micros, i.supplier_offer_id,
         i.supplier_order_ref, i.delivery_note, i.revealed_at, i.reveal_count,
         (
           SELECT p.reported_reference FROM manual_alipay_payments p
            WHERE p.order_id = o.id AND p.order_kind = 'shop'
            ORDER BY p.reported_at DESC NULLS LAST LIMIT 1
         ) AS reported_reference,
         (
           SELECT p.reported_at FROM manual_alipay_payments p
            WHERE p.order_id = o.id AND p.order_kind = 'shop'
            ORDER BY p.reported_at DESC NULLS LAST LIMIT 1
         ) AS reported_at
    FROM shop_orders o
    JOIN shop_order_items i ON i.order_id = o.id
`;

function mapOrder(row: Record<string, unknown>): ShopOrderDetail {
  return {
    id: String(row.id),
    order_no: String(row.order_no),
    status: row.status as ShopOrderStatus,
    amount_micros: toNumber(row.amount_micros as string | number),
    subtotal_micros: toNumber(row.subtotal_micros as string | number),
    payment_provider: String(row.payment_provider),
    provider_ref: row.provider_ref ? String(row.provider_ref) : null,
    pay_amount: row.pay_amount === null || row.pay_amount === undefined ? null : Number(row.pay_amount),
    pay_currency: row.pay_currency ? String(row.pay_currency) : null,
    pay_address: row.pay_address ? String(row.pay_address) : null,
    pay_txid: row.pay_txid ? String(row.pay_txid) : null,
    pay_expires_at: row.pay_expires_at ? String(row.pay_expires_at) : null,
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
    paid_at: row.paid_at ? String(row.paid_at) : null,
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    product_slug: String(row.product_slug),
    product_name: String(row.product_name),
    brand: String(row.brand),
    unit_price_micros: toNumber(row.unit_price_micros as string | number),
    qty: Number(row.qty),
    procurement_status: String(row.procurement_status),
    delivery_kind: row.delivery_kind ? String(row.delivery_kind) : null,
    delivered_at_item: row.delivered_at_item ? String(row.delivered_at_item) : null,
    customer_input_encrypted: row.customer_input_encrypted
      ? String(row.customer_input_encrypted)
      : null,
    customer_input_purged_at: row.customer_input_purged_at
      ? String(row.customer_input_purged_at)
      : null,
    reported_reference: row.reported_reference ? String(row.reported_reference) : null,
    reported_at: row.reported_at ? String(row.reported_at) : null,
    user_id: String(row.user_id),
    customer_note: String(row.customer_note || ""),
    admin_note: String(row.admin_note || ""),
    supplier_title_snapshot: String(row.supplier_title_snapshot || ""),
    supplier_cost_micros: toNumber(row.supplier_cost_micros as string | number),
    supplier_offer_id: row.supplier_offer_id ? String(row.supplier_offer_id) : null,
    supplier_order_ref: row.supplier_order_ref ? String(row.supplier_order_ref) : null,
    delivery_note: String(row.delivery_note || ""),
    revealed_at: row.revealed_at ? String(row.revealed_at) : null,
    reveal_count: Number(row.reveal_count || 0),
  };
}

export function newOrderNo(): string {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
  return `CK${stamp}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function validateCustomerInput(
  fields: ShopInputField[],
  input: Record<string, string> | null | undefined,
): Record<string, string> {
  const values = input && typeof input === "object" ? input : {};
  const result: Record<string, string> = {};
  for (const field of fields) {
    const raw = typeof values[field.key] === "string" ? values[field.key].trim() : "";
    if (field.required && !raw) throw new Error(`请填写${field.label}`);
    if (raw.length > (field.maxLength || 500)) throw new Error(`${field.label}内容过长`);
    if (raw) result[field.key] = raw;
  }
  return result;
}

export async function createShopOrder(input: {
  userId: string;
  productId: string;
  expectedPriceMicros: number;
  qty?: number;
  contactEmail?: string;
  customerInput?: Record<string, string>;
  note?: string;
  paymentProvider:
    | "alipay_easypay"
    | "alipay_manual"
    | "usdt_trc20"
    | "usdt_bsc"
    | "usdt_polygon"
    | "manual";
}): Promise<{ id: string; orderNo: string; amountMicros: number }> {
  return withTransaction(async (client) => {
    const productResult = await client.query<{
      id: string;
      slug: string;
      name: string;
      brand: string;
      price_micros: string | number;
      status: string;
      availability: string;
      pricing_review_required: boolean;
      input_fields: unknown;
      eta_max_minutes: number;
      qty_max: number;
    }>(
      `SELECT id, slug, name, brand, price_micros, status, availability,
              pricing_review_required, input_fields, eta_max_minutes,
              $2::int AS qty_max
         FROM shop_products
        WHERE id = $1
        FOR UPDATE`,
      [input.productId, config.shopMaxQty],
    );
    const product = productResult.rows[0];
    if (!product) throw new Error("商品不存在");
    if (product.status !== "active") throw new Error("商品暂不可售");
    if (product.pricing_review_required || !isPurchasable(product.availability)) {
      throw new Error("商品暂时缺货");
    }

    const priceMicros = toNumber(product.price_micros);
    if (priceMicros !== input.expectedPriceMicros) {
      throw new Error("PRICE_CHANGED");
    }
    if (priceMicros <= 0) throw new Error("商品价格异常");

    const qty = Math.trunc(Number(input.qty ?? 1));
    const qtyMax = Number(product.qty_max);
    if (!Number.isInteger(qty) || qty < 1 || qty > qtyMax) {
      throw new Error(`购买数量需在 1 到 ${qtyMax} 之间`);
    }
    const totalMicros = priceMicros * qty;
    if (!Number.isSafeInteger(totalMicros) || totalMicros <= 0) {
      throw new Error("订单金额异常");
    }

    const openResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM shop_orders
        WHERE user_id = $1
          AND status IN ('pending_payment', 'paid', 'procuring')`,
      [input.userId],
    );
    if (Number(openResult.rows[0]?.count || 0) >= config.shopMaxOpenOrders) {
      throw new Error("未完成订单过多，请先处理已有订单");
    }

    const inputFields = Array.isArray(product.input_fields)
      ? (product.input_fields as ShopInputField[])
      : [];
    const customerInput = validateCustomerInput(inputFields, input.customerInput);
    const contactEmail = String(input.contactEmail || "").trim().toLowerCase();
    if (contactEmail) {
      if (contactEmail.length > 254) throw new Error("联系邮箱过长");
      customerInput.contactEmail = contactEmail;
    }

    const sourceResult = await client.query<{
      offer_id: string;
      source_title: string;
      supplier_cost_micros: string | number;
      supplier_availability: string;
    }>(
      `SELECT s.offer_id, o.source_title, s.supplier_cost_micros, s.supplier_availability
         FROM shop_product_sources s
         JOIN shop_offers o ON o.id = s.offer_id
        WHERE s.product_id = $1 AND s.active = TRUE
        ORDER BY CASE s.role WHEN 'primary' THEN 0 ELSE 1 END, s.created_at
        LIMIT 1`,
      [product.id],
    );
    const source = sourceResult.rows[0];

    const orderNo = newOrderNo();
    const expireMinutes =
      input.paymentProvider === "alipay_manual"
        ? config.shopAlipayManualExpireMinutes
        : config.shopOrderExpireMinutes;
    const expiresAt = new Date(Date.now() + expireMinutes * 60_000);
    const orderResult = await client.query<{ id: string }>(
      `INSERT INTO shop_orders
         (order_no, user_id, status, subtotal_micros, amount_micros,
          payment_provider, expires_at, customer_note)
       VALUES ($1, $2, 'pending_payment', $3, $3, $4, $5, $6)
       RETURNING id`,
      [
        orderNo,
        input.userId,
        totalMicros,
        input.paymentProvider,
        expiresAt,
        String(input.note || "").slice(0, 1000),
      ],
    );
    const orderId = orderResult.rows[0].id;
    if (input.paymentProvider === "alipay_manual") {
      const settings = await getManualAlipaySettings();
      if (!settings.enabled || !settings.qrDataUrl || !settings.payee) throw new Error("支付宝收款暂未开放");
      await client.query("INSERT INTO manual_alipay_payments (order_id,order_kind,qr_data_url,payee) VALUES ($1,'shop',$2,$3)", [orderId,settings.qrDataUrl,settings.payee]);
    }

    await client.query(
      `INSERT INTO shop_order_items
         (order_id, product_id, product_slug, product_name, brand,
          unit_price_micros, qty, supplier_offer_id, supplier_title_snapshot,
          supplier_cost_micros, procurement_status, customer_input_encrypted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)`,
      [
        orderId,
        product.id,
        product.slug,
        product.name,
        product.brand,
        priceMicros,
        qty,
        source?.offer_id || null,
        source?.source_title || "",
        toNumber(source?.supplier_cost_micros || 0) * qty,
        Object.keys(customerInput).length > 0
          ? encryptSecret(JSON.stringify(customerInput))
          : null,
      ],
    );

    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'user', $2, 'created', $3)`,
      [orderId, input.userId, `支付方式：${input.paymentProvider}；数量：${qty}`],
    );

    return { id: orderId, orderNo, amountMicros: totalMicros };
  });
}

export async function findShopOrderByNo(
  orderNo: string,
  userId?: string,
): Promise<ShopOrderDetail | null> {
  const params: unknown[] = [orderNo];
  let condition = "o.order_no = $1";
  if (userId) {
    params.push(userId);
    condition += " AND o.user_id = $2";
  }
  const result = await query<Record<string, unknown>>(
    `${ORDER_SELECT} WHERE ${condition} LIMIT 1`,
    params,
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function listUserShopOrders(userId: string): Promise<ShopOrderDetail[]> {
  const result = await query<Record<string, unknown>>(
    `${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
    [userId],
  );
  return result.rows.map(mapOrder);
}

export async function listAdminShopOrders(filter?: {
  status?: string;
  limit?: number;
}): Promise<ShopOrderDetail[]> {
  const values: unknown[] = [];
  let condition = "TRUE";
  if (filter?.status === "reported") {
    condition += ` AND o.status = 'pending_payment'
      AND EXISTS (
        SELECT 1 FROM manual_alipay_payments p
         WHERE p.order_id = o.id AND p.order_kind = 'shop' AND p.reported_at IS NOT NULL
      )`;
  } else if (filter?.status && filter.status !== "all") {
    values.push(filter.status);
    condition += ` AND o.status = $${values.length}`;
  }
  values.push(Math.min(Math.max(filter?.limit || 100, 1), 500));
  const result = await query<Record<string, unknown>>(
    `${ORDER_SELECT}
      JOIN users u ON u.id = o.user_id
     WHERE ${condition}
     ORDER BY o.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => {
    const mapped = mapOrder(row);
    return { ...mapped, email: String(row.email || ""), name: String(row.name || "") };
  });
}

export async function getAdminShopOrder(id: string): Promise<ShopOrderDetail | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT q.*, u.email, u.name
       FROM (${ORDER_SELECT}) q
       JOIN users u ON u.id = q.user_id
      WHERE q.id = $1 LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const events = await query<{
    id: string;
    actor_type: string;
    event: string;
    note: string;
    created_at: string;
  }>(
    `SELECT id::text, actor_type, event, note, created_at
       FROM shop_order_events WHERE order_id = $1 ORDER BY created_at ASC`,
    [id],
  );
  return {
    ...mapOrder(row),
    email: String(row.email || ""),
    name: String(row.name || ""),
    events: events.rows,
  };
}

export async function markShopOrderPaid(input: {
  orderNo: string;
  provider:
    | "alipay_easypay"
    | "alipay_manual"
    | "usdt_trc20"
    | "usdt_bsc"
    | "usdt_polygon"
    | "manual";
  providerRef: string;
  paidAmountMicros?: number;
  payTxid?: string;
  adminId?: string;
  note?: string;
}): Promise<{ id: string; status: ShopOrderStatus; alreadyPaid: boolean }> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      status: ShopOrderStatus;
      amount_micros: string | number;
      payment_provider: string;
      provider_ref: string | null;
    }>(
      `SELECT id, status, amount_micros, payment_provider, provider_ref
         FROM shop_orders WHERE order_no = $1 FOR UPDATE`,
      [input.orderNo],
    );
    const order = result.rows[0];
    if (!order) throw new Error("订单不存在");

    if (order.payment_provider !== input.provider) throw new Error("支付渠道不一致");
    if (["paid", "procuring", "delivered"].includes(order.status)) {
      if (order.provider_ref !== input.providerRef) throw new Error("交易号与已收款订单不一致");
      return { id: order.id, status: order.status, alreadyPaid: true };
    }
    if (["cancelled", "expired", "refunded", "refund_pending"].includes(order.status)) {
      throw new Error("ORDER_CLOSED");
    }
    if (input.paidAmountMicros !== undefined) {
      const expected = toNumber(order.amount_micros);
      // Manual Alipay transfers are made in whole cents, and legacy order
      // prices can carry sub-cent micros (e.g. 107.142858 shown as ¥107.14).
      // Compare those at the precision the customer can actually pay.
      const manual = ["manual", "alipay_manual"].includes(input.provider);
      const cents = (micros: number) => Math.round(micros / 10_000);
      const matches = manual
        ? cents(expected) === cents(input.paidAmountMicros)
        : expected === input.paidAmountMicros;
      if (!matches) {
        throw new Error(
          `AMOUNT_MISMATCH：订单应付 ¥${(expected / 1_000_000).toFixed(2)}，与填写金额不一致`,
        );
      }
    }

    if (["manual", "alipay_manual"].includes(input.provider)) {
      if (!input.adminId || input.paidAmountMicros === undefined) throw new Error("请先核实真实到账交易号和金额");
      const admin = await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'",[input.adminId]);
      if (!admin.rows[0]) throw new Error("无权核实付款");
      await client.query("INSERT INTO payment_receipts (order_id,order_kind,provider,receipt_ref,amount_micros,reviewed_by) VALUES ($1,'shop','personal_alipay',$2,$3,$4)", [order.id,receiptReference(input.providerRef),input.paidAmountMicros,input.adminId]);
    }
    await client.query(
      `UPDATE shop_orders
          SET status = 'paid', paid_at = now(), payment_provider = $2,
              provider_ref = COALESCE($3, provider_ref),
              pay_txid = COALESCE($4, pay_txid),
              admin_note = CASE WHEN $5 <> '' THEN $5 ELSE admin_note END,
              updated_at = now()
        WHERE id = $1`,
      [order.id, input.provider, input.providerRef, input.payTxid || null, input.note || ""],
    );

    await client.query(
      `UPDATE shop_order_items
          SET procurement_status = 'to_buy', updated_at = now()
        WHERE order_id = $1 AND procurement_status = 'pending'`,
      [order.id],
    );

    await client.query(
      `INSERT INTO shop_order_events
         (order_id, actor_type, actor_id, event, note, metadata)
       VALUES ($1, $2, $3, 'paid', $4, $5)`,
      [
        order.id,
        input.adminId ? "admin" : "system",
        input.adminId || null,
        input.note || "支付已确认",
        JSON.stringify({ provider: input.provider, provider_ref: input.providerRef }),
      ],
    );

    return { id: order.id, status: "paid", alreadyPaid: false };
  });
}

export async function startShopProcurement(input: {
  orderId: string;
  adminId: string;
  supplierOrderRef?: string;
  note?: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const order = await client.query<{ status: string }>(
      `SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    if (!order.rows[0] || !["paid", "procuring"].includes(order.rows[0].status)) {
      throw new Error("订单当前状态不能开始采购");
    }
    await client.query(
      `UPDATE shop_orders SET status = 'procuring', updated_at = now() WHERE id = $1`,
      [input.orderId],
    );
    await client.query(
      `UPDATE shop_order_items
          SET procurement_status = 'bought',
              supplier_order_ref = COALESCE($2, supplier_order_ref),
              updated_at = now()
        WHERE order_id = $1 AND procurement_status IN ('pending', 'to_buy')`,
      [input.orderId, input.supplierOrderRef || null],
    );
    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'procuring', $3)`,
      [input.orderId, input.adminId, input.note || "已向供货商下单"],
    );
  });
}

export async function deliverShopItem(input: {
  orderId: string;
  adminId: string;
  kind: "account" | "code" | "manual_note";
  payload: Record<string, string> | string;
  note?: string;
}): Promise<{ orderDelivered: boolean }> {
  return withTransaction(async (client) => {
    const order = await client.query<{ status: string }>(
      `SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    if (!order.rows[0] || !["paid", "procuring"].includes(order.rows[0].status)) {
      throw new Error("订单当前状态不能交付");
    }

    const payloadText =
      typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload);
    if (!payloadText.trim()) throw new Error("交付内容不能为空");

    await client.query(
      `UPDATE shop_order_items
          SET delivery_kind = $2,
              delivery_payload_encrypted = $3,
              delivery_note = $4,
              procurement_status = 'delivered',
              delivered_at = now(),
              updated_at = now()
        WHERE order_id = $1 AND procurement_status <> 'refunded'`,
      [input.orderId, input.kind, encryptSecret(payloadText), String(input.note || "").slice(0, 2000)],
    );

    const remaining = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM shop_order_items
        WHERE order_id = $1 AND procurement_status <> 'delivered' AND procurement_status <> 'refunded'`,
      [input.orderId],
    );
    const delivered = Number(remaining.rows[0]?.count || 0) === 0;

    await client.query(
      `UPDATE shop_orders
          SET status = CASE WHEN $2 THEN 'delivered' ELSE 'procuring' END,
              delivered_at = CASE WHEN $2 THEN now() ELSE delivered_at END,
              updated_at = now()
        WHERE id = $1`,
      [input.orderId, delivered],
    );
    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'delivered', $3)`,
      [input.orderId, input.adminId, input.note || "已交付"],
    );
    return { orderDelivered: delivered };
  });
}

export async function markShopItemOutOfStock(input: {
  orderId: string;
  adminId: string;
  reason: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE shop_order_items
          SET procurement_status = 'out_of_stock', updated_at = now()
        WHERE order_id = $1 AND procurement_status NOT IN ('delivered', 'refunded')`,
      [input.orderId],
    );
    await client.query(
      `UPDATE shop_orders
          SET status = 'refund_pending', updated_at = now()
        WHERE id = $1 AND status IN ('paid', 'procuring')`,
      [input.orderId],
    );
    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'out_of_stock', $3)`,
      [input.orderId, input.adminId, input.reason.slice(0, 1000)],
    );
  });
}

/**
 * Moves a paid order into negotiated refund. The operator agrees the refund
 * with the customer first (Alipay QR code / name), then pays manually and
 * records it with refundShopOrder. Nothing is refunded automatically.
 */
export async function requestShopRefund(input: {
  orderId: string;
  adminId: string;
  reason?: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const order = await client.query<{ status: string }>(
      `SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const row = order.rows[0];
    if (!row) throw new Error("订单不存在");
    if (row.status === "refund_pending") return;
    if (!["paid", "procuring"].includes(row.status)) {
      throw new Error("只有已支付、处理中的订单可以转退款协商");
    }
    await client.query(
      `UPDATE shop_orders SET status = 'refund_pending', updated_at = now() WHERE id = $1`,
      [input.orderId],
    );
    await client.query(
      `UPDATE shop_order_items
          SET procurement_status = 'out_of_stock', updated_at = now()
        WHERE order_id = $1 AND procurement_status NOT IN ('delivered', 'refunded')`,
      [input.orderId],
    );
    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'refund_requested', $3)`,
      [input.orderId, input.adminId, (input.reason || "协商退款").slice(0, 1000)],
    );
  });
}

export async function refundShopOrder(input: {
  orderId: string;
  adminId: string;
  amountMicros: number;
  reason: string;
  providerRef?: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const order = await client.query<{ status: string; amount_micros: string | number }>(
      `SELECT status, amount_micros FROM shop_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const row = order.rows[0];
    if (!row) throw new Error("订单不存在");
    if (row.status === "refunded") return;

    await client.query(
      `INSERT INTO shop_refunds
         (order_id, amount_micros, reason, provider, provider_ref, status, admin_id, completed_at)
       VALUES ($1, $2, $3, 'manual', $4, 'completed', $5, now())`,
      [
        input.orderId,
        Math.min(input.amountMicros, toNumber(row.amount_micros)),
        input.reason.slice(0, 1000),
        input.providerRef || null,
        input.adminId,
      ],
    );
    await client.query(
      `UPDATE shop_order_items
          SET procurement_status = 'refunded', updated_at = now()
        WHERE order_id = $1`,
      [input.orderId],
    );
    await client.query(
      `UPDATE shop_orders SET status = 'refunded', updated_at = now() WHERE id = $1`,
      [input.orderId],
    );
    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'refunded', $3)`,
      [input.orderId, input.adminId, input.reason.slice(0, 1000)],
    );
  });
}

export async function revealShopDelivery(input: {
  orderId: string;
  userId: string;
}): Promise<{ kind: string; payload: Record<string, string>; note: string }> {
  const result = await query<{
    delivery_kind: string;
    delivery_payload_encrypted: string | null;
    delivery_note: string;
    procurement_status: string;
    order_status: string;
  }>(
    `SELECT i.delivery_kind, i.delivery_payload_encrypted, i.delivery_note,
            i.procurement_status, o.status AS order_status
       FROM shop_order_items i
       JOIN shop_orders o ON o.id = i.order_id
      WHERE i.order_id = $1 AND o.user_id = $2
      LIMIT 1`,
    [input.orderId, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("订单不存在");
  if (!row.delivery_payload_encrypted || row.procurement_status !== "delivered") {
    throw new Error("暂无可查看的交付内容");
  }

  let payload: Record<string, string>;
  try {
    const parsed = JSON.parse(decryptSecret(row.delivery_payload_encrypted));
    payload =
      parsed && typeof parsed === "object"
        ? Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]),
          )
        : { 内容: String(parsed ?? "") };
  } catch {
    throw new Error("交付内容读取失败，请联系客服");
  }

  await query(
    `UPDATE shop_order_items
        SET revealed_at = now(), reveal_count = reveal_count + 1
      WHERE order_id = $1`,
    [input.orderId],
  );
  await query(
    `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event)
     VALUES ($1, 'user', $2, 'revealed')`,
    [input.orderId, input.userId],
  );

  return { kind: row.delivery_kind || "manual_note", payload, note: row.delivery_note };
}

export function decryptCustomerInput(encrypted: string | null): Record<string, string> {
  if (!encrypted) return {};
  try {
    const parsed = JSON.parse(decryptSecret(encrypted));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function expireShopOrders(): Promise<number> {
  const result = await query(
    `UPDATE shop_orders o
        SET status = 'expired', updated_at = now()
      WHERE o.status = 'pending_payment'
        AND o.expires_at < now()
        AND NOT EXISTS (
          SELECT 1 FROM shop_usdt_deposits d
           WHERE d.order_id = o.id AND d.received_usdt > 0
        )
        -- The buyer says they paid: wait for the operator instead of expiring
        -- an order whose money may already be in the merchant account.
        AND NOT (
          o.payment_provider = 'alipay_manual'
          AND EXISTS (
            SELECT 1 FROM manual_alipay_payments m
             WHERE m.order_id = o.id AND m.reported_at IS NOT NULL
          )
        )
        -- Cancel a USDT order only after the scanner explicitly found no
        -- funds. A TronGrid outage must leave it pending for the next scan.
        AND (
          o.payment_provider NOT IN ('usdt_trc20', 'usdt_bsc', 'usdt_polygon')
          OR NOT EXISTS (
            SELECT 1 FROM shop_usdt_deposits d WHERE d.order_id = o.id
          )
          OR EXISTS (
            SELECT 1
              FROM shop_usdt_deposits d
             WHERE d.order_id = o.id
               AND d.status = 'expired'
               AND d.received_usdt = 0
          )
        )
      RETURNING o.id`,
  );
  for (const row of result.rows) {
    await query(
      `INSERT INTO shop_order_events (order_id, actor_type, event, note)
       VALUES ($1, 'system', 'expired', '超时未支付')`,
      [row.id],
    );
  }
  await query(
    `UPDATE shop_usdt_deposits d
        SET status = 'expired', updated_at = now()
       FROM shop_orders o
      WHERE d.order_id = o.id
        AND d.status = 'waiting'
        AND d.received_usdt = 0
        AND d.expires_at < now()
        AND o.status IN ('expired', 'cancelled')`,
  );
  return result.rowCount || 0;
}

export async function purgeDeliveredCustomerInputs(): Promise<number> {
  const result = await query(
    `UPDATE shop_order_items
        SET customer_input_encrypted = NULL, customer_input_purged_at = now()
      WHERE customer_input_encrypted IS NOT NULL
        AND delivered_at IS NOT NULL
        AND delivered_at < now() - ($1::int * INTERVAL '1 day')`,
    [config.shopCustomerInputRetentionDays],
  );
  return result.rowCount || 0;
}

export async function suggestPrimaryOffer(productId: string): Promise<{
  offerId: string;
  title: string;
  url: string;
  costMicros: number;
  availability: string;
} | null> {
  const result = await query<{
    offer_id: string;
    source_title: string;
    url: string;
    supplier_cost_micros: string | number;
    supplier_availability: string;
  }>(
    `SELECT s.offer_id, o.source_title, o.url, s.supplier_cost_micros, s.supplier_availability
       FROM shop_product_sources s
       JOIN shop_offers o ON o.id = s.offer_id
      WHERE s.product_id = $1 AND s.active = TRUE
      ORDER BY CASE s.role WHEN 'primary' THEN 0 ELSE 1 END, s.created_at
      LIMIT 1`,
    [productId],
  );
  const row = result.rows[0];
  return row
    ? {
        offerId: row.offer_id,
        title: row.source_title,
        url: row.url,
        costMicros: toNumber(row.supplier_cost_micros),
        availability: row.supplier_availability,
      }
    : null;
}
