import { sha256, randomToken } from "@/lib/crypto";
import { query, withTransaction } from "@/lib/db";
import { formatCny } from "@/lib/money";
import { sanitizeSupplierCopy } from "@/lib/shop/sanitize";
import { deliverShopItem } from "@/lib/shop/orders";

const TOKEN_PREFIX = "coke-cap-";
// Long enough for one operator shift, short enough that a leaked token
// expires before it can be reused across days.
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const CAPTURE_WINDOW_MINUTES = 30;
const MAX_FIELD = 2000;
const MAX_FIELDS = 50;
const MAX_ACTIVE_TOKENS = 3;

// 自动回填门槛：待采购积压达到该单数才启用扩展接管，否则运营继续
// 手工下单+回填。SHOP_CAPTURE_MIN_QUEUE 可覆盖，默认 7。
export const CAPTURE_MIN_QUEUE = Math.max(
  1,
  Number(process.env.SHOP_CAPTURE_MIN_QUEUE ?? 7) || 7,
);

export type CaptureGate = {
  enabled: boolean;
  depth: number;
  min: number;
};

export async function captureQueueDepth(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
      WHERE o.status IN ('paid', 'procuring')
        AND i.procurement_status NOT IN ('delivered', 'refunded')`,
  );
  return Number(result.rows[0]?.count || 0);
}

export async function captureGate(): Promise<CaptureGate> {
  const depth = await captureQueueDepth();
  return { enabled: depth >= CAPTURE_MIN_QUEUE, depth, min: CAPTURE_MIN_QUEUE };
}

export type CaptureQueueItem = {
  id: string;
  orderNo: string;
  productName: string;
  qty: number;
  amountLabel: string;
  supplierTitle: string | null;
  supplierUrl: string | null;
  captureUntil: string;
};

export type CaptureAdmin = {
  id: string;
  email: string;
};

// Supplier URLs come from third-party feeds; never hand a non-http(s) URL to
// the queue page or window.open.
function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function issueCaptureToken(adminId: string): Promise<{
  token: string;
  expiresAt: string;
}> {
  await query(`DELETE FROM shop_capture_tokens WHERE expires_at < now()`, []);
  // Several admin tabs may mint concurrently; keep the newest few instead of
  // invalidating each other on every refresh.
  await query(
    `DELETE FROM shop_capture_tokens
      WHERE admin_id = $1
        AND token_hash NOT IN (
          SELECT token_hash FROM shop_capture_tokens
           WHERE admin_id = $1
           ORDER BY created_at DESC
           LIMIT $2
        )`,
    [adminId, MAX_ACTIVE_TOKENS - 1],
  );
  const token = `${TOKEN_PREFIX}${randomToken(24)}`;
  const expires = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  await query(
    `INSERT INTO shop_capture_tokens (token_hash, admin_id, expires_at)
     VALUES ($1, $2, $3)`,
    [sha256(token), adminId, expires.toISOString()],
  );
  return { token, expiresAt: expires.toISOString() };
}

export async function adminFromCaptureToken(raw: string): Promise<CaptureAdmin | null> {
  const token = raw.trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const result = await query<{ id: string; email: string }>(
    `SELECT u.id, u.email
       FROM shop_capture_tokens t
       JOIN users u ON u.id = t.admin_id
      WHERE t.token_hash = $1
        AND t.expires_at > now()
        AND u.status = 'active'
        AND u.role = 'admin'
      LIMIT 1`,
    [sha256(token)],
  );
  const row = result.rows[0];
  return row ? { id: row.id, email: row.email } : null;
}

export async function beginShopCapture(input: {
  orderId: string;
  adminId: string;
}): Promise<{ supplierUrl: string | null; orderNo: string }> {
  const gate = await captureGate();
  if (!gate.enabled) {
    throw new Error(
      `自动回填未启用：当前待采购 ${gate.depth} 单，门槛 ${gate.min} 单（SHOP_CAPTURE_MIN_QUEUE）。请走人工采购。`,
    );
  }
  return withTransaction(async (client) => {
    const order = await client.query<{
      status: string;
      order_no: string;
      procurement_status: string;
    }>(
      `SELECT o.status, o.order_no, i.procurement_status
         FROM shop_orders o
         JOIN shop_order_items i ON i.order_id = o.id
        WHERE o.id = $1
        FOR UPDATE OF o`,
      [input.orderId],
    );
    const row = order.rows[0];
    if (!row || !["paid", "procuring"].includes(row.status)) {
      throw new Error("订单当前状态不能开始采购");
    }
    if (["delivered", "refunded"].includes(row.procurement_status)) {
      throw new Error("订单已经交付或退款，不能再回填");
    }
    await client.query(
      `UPDATE shop_orders
          SET status = 'procuring',
              capture_pending_until = now() + ($2::int * interval '1 minute'),
              updated_at = now()
        WHERE id = $1`,
      [input.orderId, CAPTURE_WINDOW_MINUTES],
    );
    await client.query(
      `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
       VALUES ($1, 'admin', $2, 'capture_pending', $3)`,
      [
        input.orderId,
        input.adminId,
        `等待采购助手回填（${CAPTURE_WINDOW_MINUTES} 分钟）`,
      ],
    );
    const offer = await client.query<{ url: string | null }>(
      `SELECT COALESCE(f.url, cur.url) AS url
         FROM shop_order_items i
         LEFT JOIN shop_offers f ON f.id = i.supplier_offer_id
         LEFT JOIN LATERAL (
           SELECT o.url
             FROM shop_product_sources s
             JOIN shop_offers o ON o.id = s.offer_id
            WHERE s.product_id = i.product_id AND s.active = TRUE
              AND (s.variant_id = i.variant_id OR s.variant_id IS NULL)
            ORDER BY CASE WHEN s.variant_id IS NOT NULL THEN 0 ELSE 1 END,
                     CASE s.role WHEN 'primary' THEN 0 ELSE 1 END,
                     s.created_at DESC
            LIMIT 1
         ) cur ON TRUE
        WHERE i.order_id = $1
        LIMIT 1`,
      [input.orderId],
    );
    return {
      supplierUrl: safeHttpUrl(offer.rows[0]?.url),
      orderNo: row.order_no,
    };
  });
}

export async function listCaptureQueue(): Promise<CaptureQueueItem[]> {
  const result = await query<{
    id: string;
    order_no: string;
    product_name: string;
    qty: string;
    amount_micros: string;
    supplier_title: string | null;
    url: string | null;
    capture_pending_until: string;
  }>(
    `SELECT o.id, o.order_no, i.product_name, i.qty::text, o.amount_micros::text,
            o.capture_pending_until,
            COALESCE(i.supplier_title_snapshot, f.source_title) AS supplier_title,
            COALESCE(f.url, cur.url) AS url
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
       LEFT JOIN shop_offers f ON f.id = i.supplier_offer_id
       LEFT JOIN LATERAL (
         SELECT off.url
           FROM shop_product_sources s
           JOIN shop_offers off ON off.id = s.offer_id
          WHERE s.product_id = i.product_id AND s.active = TRUE
            AND (s.variant_id = i.variant_id OR s.variant_id IS NULL)
          ORDER BY CASE WHEN s.variant_id IS NOT NULL THEN 0 ELSE 1 END,
                   CASE s.role WHEN 'primary' THEN 0 ELSE 1 END,
                   s.created_at DESC
          LIMIT 1
       ) cur ON TRUE
      WHERE o.status IN ('paid', 'procuring')
        AND o.capture_pending_until > now()
        AND i.procurement_status NOT IN ('delivered', 'refunded')
      ORDER BY o.capture_pending_until ASC
      LIMIT 20`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    orderNo: row.order_no,
    productName: row.product_name,
    qty: Number(row.qty),
    amountLabel: formatCny(row.amount_micros),
    supplierTitle: row.supplier_title || null,
    supplierUrl: safeHttpUrl(row.url),
    captureUntil: row.capture_pending_until,
  }));
}

export type CapturePayload = {
  kind: "code" | "account" | "manual_note";
  fields: Record<string, string>;
  supplierOrderRef?: string;
  pageUrl?: string;
};

function clip(value: string): string {
  return value.replace(/\u0000/g, "").trim().slice(0, MAX_FIELD);
}

function cleanFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (Object.keys(out).length >= MAX_FIELDS) break;
    const label = clip(String(key)).slice(0, 40);
    const raw = clip(String(value));
    if (!label || !raw) continue;
    // CDK / account secrets can look like domains; only scrub instruction text.
    out[label] = /说明|备注|注意/.test(label) ? sanitizeSupplierCopy(raw) : raw;
  }
  return out;
}

export async function applyShopCapture(input: {
  orderId: string;
  adminId: string;
  payload: CapturePayload;
}): Promise<{ orderNo: string; orderDelivered: boolean }> {
  const fields = cleanFields(input.payload.fields);
  if (Object.keys(fields).length === 0) {
    throw new Error("没有可回填的交付内容");
  }
  const kind = input.payload.kind;
  if (kind !== "code" && kind !== "account" && kind !== "manual_note") {
    throw new Error("交付类型无效");
  }

  const locked = await query<{
    order_no: string;
    status: string;
    capture_pending_until: string | null;
    procurement_status: string;
  }>(
    `SELECT o.order_no, o.status, o.capture_pending_until, i.procurement_status
       FROM shop_orders o
       JOIN shop_order_items i ON i.order_id = o.id
      WHERE o.id = $1
      LIMIT 1`,
    [input.orderId],
  );
  const row = locked.rows[0];
  if (!row) throw new Error("订单不存在");
  if (!["paid", "procuring"].includes(row.status)) {
    throw new Error("订单当前状态不能交付");
  }
  if (row.procurement_status === "delivered") {
    throw new Error("订单已经交付");
  }
  if (!row.capture_pending_until || new Date(row.capture_pending_until).getTime() < Date.now()) {
    throw new Error("这单没有在等待回填，请先在采购队列点「去采购」");
  }

  const ref = clip(input.payload.supplierOrderRef || "").slice(0, 200);
  if (ref) {
    await query(
      `UPDATE shop_order_items
          SET supplier_order_ref = COALESCE(supplier_order_ref, $2),
              updated_at = now()
        WHERE order_id = $1`,
      [input.orderId, ref],
    );
  }

  // delivery_note is rendered on the buyer's order page. Never forward the
  // supplier URL there — it would leak the source store to the customer.
  // Keep the page URL on the admin-side event log only.
  await query(
    `INSERT INTO shop_order_events (order_id, actor_type, actor_id, event, note)
     VALUES ($1, 'admin', $2, 'capture_applied', $3)`,
    [
      input.orderId,
      input.adminId,
      clip(input.payload.pageUrl || "采购助手回填").slice(0, 500),
    ],
  );

  const delivered = await deliverShopItem({
    orderId: input.orderId,
    adminId: input.adminId,
    kind,
    payload: fields,
    note: "采购助手回填",
  });
  await query(
    `UPDATE shop_orders SET capture_pending_until = NULL, updated_at = now() WHERE id = $1`,
    [input.orderId],
  );
  return { orderNo: row.order_no, orderDelivered: delivered.orderDelivered };
}
