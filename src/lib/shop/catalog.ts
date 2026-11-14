import { query } from "@/lib/db";
import { parseInputFields, parseStringList, type ShopInputField } from "./copy";
import { preorderSql } from "./preorder";
import { sanitizeStoredRichHtml } from "./rich-description";
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

export type ShopDescriptionImage = {
  url: string;
  alt: string;
};

export type ProductMedia = {
  image_url: string | null;
  description_images: ShopDescriptionImage[];
};

export type PublicShopProduct = {
  id: string;
  slug: string;
  brand: string;
  category: string;
  product_type: string;
  name: string;
  subtitle: string;
  description: string;
  description_html: string;
  cover_variant: string;
  price_micros: number;
  /** Retail price before an active member discount, when one was applied. */
  list_price_micros?: number | null;
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
  /** Supplier sells this listing as a preorder; overrides stock/ETA labels. */
  preorder: boolean;
  featured: boolean;
  sort_order: number;
  display_category: string;
  image_url: string | null;
  description_images: ShopDescriptionImage[];
  help_article_ids: string[];
};

type RawProduct = Omit<
  PublicShopProduct,
  | "includes"
  | "usage_notes"
  | "input_fields"
  | "help_article_ids"
  | "image_url"
  | "description_images"
> & {
  includes: unknown;
  usage_notes: unknown;
  input_fields: unknown;
  help_article_ids: unknown;
};

/** JSONB may arrive parsed (pg) or as the raw string from a manual SQL edit. */
function parseHelpArticleIds(value: unknown): string[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function hydrate(row: RawProduct): PublicShopProduct {
  return {
    ...row,
    price_micros: Number(row.price_micros),
    eta_min_minutes: Number(row.eta_min_minutes),
    eta_max_minutes: Number(row.eta_max_minutes),
    warranty_days: Number(row.warranty_days),
    sort_order: Number(row.sort_order),
    preorder: Boolean(row.preorder),
    featured: Boolean(row.featured),
    includes: parseStringList(row.includes),
    usage_notes: parseStringList(row.usage_notes),
    input_fields: parseInputFields(row.input_fields),
    help_article_ids: parseHelpArticleIds(row.help_article_ids),
    display_category: String(row.display_category || ""),
    description_html: String(row.description_html || ""),
    image_url: null,
    description_images: [],
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

type ProductImageRow = {
  product_id: string;
  image_hash: string;
  kind: string;
  position: number;
  ext: string;
  alt: string | null;
};

/**
 * Loads mirrored product images in one query. The image bytes stay in
 * shop_images; the public URL points at /api/shop/images/<hash>.<ext>.
 * Before the migration lands the table is absent, so a failed read must not
 * take the whole catalog down: log once and fall back to no media.
 */
export async function loadProductMedia(productIds: string[]): Promise<Map<string, ProductMedia>> {
  const media = new Map<string, ProductMedia>();
  if (productIds.length === 0) return media;

  try {
    const rows = await query<ProductImageRow>(
      `SELECT spi.product_id, spi.image_hash, spi.kind, spi.position,
              si.ext, COALESCE(spi.alt, '') AS alt
         FROM shop_product_images spi
         JOIN shop_images si ON si.hash = spi.image_hash
        WHERE spi.product_id = ANY($1::uuid[])
        ORDER BY spi.kind ASC, spi.position ASC`,
      [productIds],
    );
    for (const row of rows.rows) {
      if (!row.image_hash || !row.ext) continue;
      const url = `/api/shop/images/${row.image_hash}.${row.ext}`;
      let entry = media.get(row.product_id);
      if (!entry) {
        entry = { image_url: null, description_images: [] };
        media.set(row.product_id, entry);
      }
      if (row.kind === "cover") {
        if (!entry.image_url) entry.image_url = url;
      } else {
        entry.description_images.push({ url, alt: row.alt || "" });
      }
    }
  } catch (error) {
    console.warn("shop product media unavailable:", error);
  }
  return media;
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
    description_html: sanitizeStoredRichHtml(product.description_html, identities),
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

/**
 * Mirrored image alt text comes from the supplier page too, so it is an
 * output channel just like the description. Apply the same scrubber to it
 * before the product reaches a public page.
 */
function sanitizeMediaEntry(
  entry: ProductMedia | undefined,
  identities: SupplierIdentity[],
): ProductMedia {
  if (!entry) return { image_url: null, description_images: [] };
  const clean = (text: string): string => {
    let out = sanitizeSupplierCopy(text);
    for (const identity of identities) out = sanitizeSupplierCopy(out, identity);
    return out;
  };
  return {
    image_url: entry.image_url,
    description_images: entry.description_images.map((image) => ({
      ...image,
      alt: clean(image.alt),
    })),
  };
}

const PUBLIC_COLUMNS = `
  id, slug, brand, category, product_type, name, subtitle, description,
  cover_variant, price_micros, delivery_method, eta_min_minutes, eta_max_minutes,
  warranty_type, warranty_days, warranty_note, includes, usage_notes, customer_notice,
  refund_policy, input_fields, availability, featured, sort_order, help_article_ids,
  display_category,
  -- Preorder has three sources: the operator switch (preorder_manual), the
  -- supplier marker in availability_reason, and Muse's operating policy.
  -- Only the derived boolean reaches public types.
  ${preorderSql()} AS preorder
`;
const DETAIL_COLUMNS = `${PUBLIC_COLUMNS}, description_html`;

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

  // List cards never render the article, so skip the (potentially large)
  // rich text here and only load it on the detail page.
  const rows = await query<RawProduct>(
    `SELECT ${PUBLIC_COLUMNS}, '' AS description_html
       FROM shop_products
      WHERE ${conditions.join(" AND ")}
      ORDER BY featured DESC, sort_order ASC, created_at ASC`,
    values,
  );
  const products = rows.rows.map(hydrate);
  const productIds = products.map((product) => product.id);
  const [identities, media] = await Promise.all([
    loadProductIdentities(productIds),
    loadProductMedia(productIds),
  ]);
  return products.map((product) => {
    const productIdentities = identities.get(product.id) || [];
    const clean = sanitizePublicProduct(product, productIdentities);
    const mediaEntry = sanitizeMediaEntry(media.get(product.id), productIdentities);
    return {
      ...clean,
      image_url: mediaEntry.image_url,
      description_images: mediaEntry.description_images,
    };
  });
}

export async function getPublicProduct(slug: string): Promise<PublicShopProduct | null> {
  const rows = await query<RawProduct>(
    `SELECT ${DETAIL_COLUMNS}
       FROM shop_products
      WHERE slug = $1 AND status = 'active' AND copy_ready = TRUE
      LIMIT 1`,
    [slug],
  );
  const row = rows.rows[0];
  if (!row) return null;
  const product = hydrate(row);
  const [identities, media] = await Promise.all([
    loadProductIdentities([product.id]),
    loadProductMedia([product.id]),
  ]);
  const productIdentities = identities.get(product.id) || [];
  const clean = sanitizePublicProduct(product, productIdentities);
  const mediaEntry = sanitizeMediaEntry(media.get(product.id), productIdentities);
  return {
    ...clean,
    image_url: mediaEntry.image_url,
    description_images: mediaEntry.description_images,
  };
}

export type AdminShopProduct = PublicShopProduct & {
  status: string;
  availability_reason: string | null;
  pricing_review_required: boolean;
  copy_ready: boolean;
  compliance_ack_at: string | null;
  published_at: string | null;
  price_locked: boolean;
  price_locked_at: string | null;
  /** Operator-forced preorder, independent of supplier stock. */
  preorder_manual: boolean;
  created_at: string;
  updated_at: string;
};

export async function listAdminProducts(): Promise<AdminShopProduct[]> {
  const rows = await query<RawProduct & Omit<AdminShopProduct, keyof RawProduct>>(
    `SELECT ${DETAIL_COLUMNS},
            status, availability_reason, pricing_review_required, copy_ready,
            compliance_ack_at, published_at, price_locked, price_locked_at,
            preorder_manual, created_at, updated_at
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
    price_locked: Boolean(row.price_locked),
    price_locked_at: row.price_locked_at,
    preorder_manual: Boolean(row.preorder_manual),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function getAdminProduct(id: string): Promise<AdminShopProduct | null> {
  const rows = await query<RawProduct & Omit<AdminShopProduct, keyof RawProduct>>(
    `SELECT ${DETAIL_COLUMNS},
            status, availability_reason, pricing_review_required, copy_ready,
            compliance_ack_at, published_at, price_locked, price_locked_at,
            preorder_manual, created_at, updated_at
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
    price_locked: Boolean(row.price_locked),
    price_locked_at: row.price_locked_at,
    preorder_manual: Boolean(row.preorder_manual),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function suggestRetailPrice(costMicros: number, targetMarginBps = 2_200): number {
  if (costMicros <= 0) return 0;
  const margin = Math.min(Math.max(targetMarginBps, 0), 9_000);
  const raw = Math.ceil((costMicros * 10_000) / (10_000 - margin));
  // Orders store micros, but customers see and pay two decimal places; a
  // sub-cent price can never be matched by a bank transfer. Round up to
  // whole cents. Legacy rows keep their old price until the next sync.
  return Math.ceil(raw / 10_000) * 10_000;
}
