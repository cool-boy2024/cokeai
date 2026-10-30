import { query } from "@/lib/db";
import { parseInputFields, parseStringList, type ShopInputField } from "./copy";
import {
  sanitizeSupplierCopy,
  sanitizeSupplierLines,
  type SupplierIdentity,
} from "./sanitize";

export const SHOP_BRANDS = [
  { key: "all", label: "全部" },
  { key: "chatgpt", label: "ChatGPT" },
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
  { key: "grok", label: "Grok" },
  { key: "muse", label: "Muse" },
] as const;

export type ShopBrand = Exclude<(typeof SHOP_BRANDS)[number]["key"], "all"> | "other";

export type PublicShopProduct = {
  id: string;
  slug: string;
  brand: string;
  category: string;
  product_type: string;
  name: string;
  subtitle: string;
  description: string;
  cover_variant: string;
  price_micros: number;
  delivery_method: string;
  eta_min_minutes: number;
  eta_max_minutes: number;
  warranty_type: string;
  warranty_days: number;
  warranty_note: string;
  includes: string[];
  usage_notes: string[];
  customer_notice: string;
  refund_policy: string;
  input_fields: ShopInputField[];
  availability: string;
  featured: boolean;
  sort_order: number;
};

type RawProduct = Omit<PublicShopProduct, "includes" | "usage_notes" | "input_fields"> & {
  includes: unknown;
  usage_notes: unknown;
  input_fields: unknown;
};

function hydrate(row: RawProduct): PublicShopProduct {
  return {
    ...row,
    price_micros: Number(row.price_micros),
    eta_min_minutes: Number(row.eta_min_minutes),
    eta_max_minutes: Number(row.eta_max_minutes),
    warranty_days: Number(row.warranty_days),
    sort_order: Number(row.sort_order),
    featured: Boolean(row.featured),
    includes: parseStringList(row.includes),
    usage_notes: parseStringList(row.usage_notes),
    input_fields: parseInputFields(row.input_fields),
  };
}

type SourceIdentityRow = {
  product_id: string;
  source_store: string | null;
  url: string | null;
};

/**
 * Public catalog reads are the last line of defence: even copy written before
 * the supplier scrubber existed (or by a manual SQL edit) must not expose the
 * source shop. Admin reads stay raw.
 */
async function loadProductIdentities(
  productIds: string[],
): Promise<Map<string, SupplierIdentity[]>> {
  const grouped = new Map<string, SupplierIdentity[]>();
  if (productIds.length === 0) return grouped;

  const rows = await query<SourceIdentityRow>(
    `SELECT s.product_id, o.source_store, o.url
       FROM shop_product_sources s
       JOIN shop_offers o ON o.id = s.offer_id
      WHERE s.product_id = ANY($1::uuid[])`,
    [productIds],
  );
  for (const row of rows.rows) {
    const list = grouped.get(row.product_id) || [];
    list.push({ store: row.source_store, url: row.url });
    grouped.set(row.product_id, list);
  }
  return grouped;
}

function sanitizePublicProduct(
  product: PublicShopProduct,
  identities: SupplierIdentity[],
): PublicShopProduct {
  const clean = (text: string): string => {
    let out = sanitizeSupplierCopy(text);
    for (const identity of identities) out = sanitizeSupplierCopy(out, identity);
    return out;
  };
  const cleanLines = (lines: string[]): string[] => {
    let out = sanitizeSupplierLines(lines);
    for (const identity of identities) out = sanitizeSupplierLines(out, identity);
    return out;
  };

  return {
    ...product,
    name: clean(product.name),
    subtitle: clean(product.subtitle),
    description: clean(product.description),
    warranty_note: clean(product.warranty_note),
    includes: cleanLines(product.includes),
    usage_notes: cleanLines(product.usage_notes),
    customer_notice: clean(product.customer_notice),
    refund_policy: clean(product.refund_policy),
    input_fields: product.input_fields.map((field) => ({
      ...field,
      label: clean(field.label),
      placeholder: field.placeholder ? clean(field.placeholder) : field.placeholder,
      help: field.help ? clean(field.help) : field.help,
    })),
  };
}

const PUBLIC_COLUMNS = `
  id, slug, brand, category, product_type, name, subtitle, description,
  cover_variant, price_micros, delivery_method, eta_min_minutes, eta_max_minutes,
  warranty_type, warranty_days, warranty_note, includes, usage_notes, customer_notice,
  refund_policy, input_fields, availability, featured, sort_order
`;

export async function listPublicProducts(filter?: {
  brand?: string;
  category?: string;
  availability?: string;
}): Promise<PublicShopProduct[]> {
  const conditions = ["status = 'active'", "copy_ready = TRUE", "price_micros > 0"];
  const values: unknown[] = [];

  if (filter?.brand && filter.brand !== "all") {
    values.push(filter.brand);
    conditions.push(`brand = $${values.length}`);
  }
  if (filter?.category) {
    values.push(filter.category);
    conditions.push(`category = $${values.length}`);
  }
  if (filter?.availability === "available") {
    conditions.push("availability IN ('in_stock', 'low_stock')");
  }

  const rows = await query<RawProduct>(
    `SELECT ${PUBLIC_COLUMNS}
       FROM shop_products
      WHERE ${conditions.join(" AND ")}
      ORDER BY featured DESC, sort_order ASC, created_at ASC`,
    values,
  );
  const products = rows.rows.map(hydrate);
  const identities = await loadProductIdentities(products.map((product) => product.id));
  return products.map((product) =>
    sanitizePublicProduct(product, identities.get(product.id) || []),
  );
}

export async function getPublicProduct(slug: string): Promise<PublicShopProduct | null> {
  const rows = await query<RawProduct>(
    `SELECT ${PUBLIC_COLUMNS}
       FROM shop_products
      WHERE slug = $1 AND status = 'active' AND copy_ready = TRUE
      LIMIT 1`,
    [slug],
  );
  const row = rows.rows[0];
  if (!row) return null;
  const product = hydrate(row);
  const identities = await loadProductIdentities([product.id]);
  return sanitizePublicProduct(product, identities.get(product.id) || []);
}

export type AdminShopProduct = PublicShopProduct & {
  status: string;
  availability_reason: string | null;
  pricing_review_required: boolean;
  copy_ready: boolean;
  compliance_ack_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listAdminProducts(): Promise<AdminShopProduct[]> {
  const rows = await query<RawProduct & Omit<AdminShopProduct, keyof RawProduct>>(
    `SELECT ${PUBLIC_COLUMNS},
            status, availability_reason, pricing_review_required, copy_ready,
            compliance_ack_at, published_at, created_at, updated_at
       FROM shop_products
      ORDER BY sort_order ASC, created_at DESC`,
  );
  return rows.rows.map((row) => ({
    ...hydrate(row),
    status: row.status,
    availability_reason: row.availability_reason,
    pricing_review_required: Boolean(row.pricing_review_required),
    copy_ready: Boolean(row.copy_ready),
    compliance_ack_at: row.compliance_ack_at,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function getAdminProduct(id: string): Promise<AdminShopProduct | null> {
  const rows = await query<RawProduct & Omit<AdminShopProduct, keyof RawProduct>>(
    `SELECT ${PUBLIC_COLUMNS},
            status, availability_reason, pricing_review_required, copy_ready,
            compliance_ack_at, published_at, created_at, updated_at
       FROM shop_products
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return {
    ...hydrate(row),
    status: row.status,
    availability_reason: row.availability_reason,
    pricing_review_required: Boolean(row.pricing_review_required),
    copy_ready: Boolean(row.copy_ready),
    compliance_ack_at: row.compliance_ack_at,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function suggestRetailPrice(costMicros: number, targetMarginBps = 2_200): number {
  if (costMicros <= 0) return 0;
  const margin = Math.min(Math.max(targetMarginBps, 0), 9_000);
  return Math.ceil((costMicros * 10_000) / (10_000 - margin));
}
