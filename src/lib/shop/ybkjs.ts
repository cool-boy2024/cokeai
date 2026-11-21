import { query, withTransaction } from "@/lib/db";
import { autoRetailPrice } from "@/lib/shop/auto-pricing";
import { normalizeDisplayCategory } from "@/lib/shop/categories";
import { replaceProductImages } from "@/lib/shop/images";
import { buildRichDescriptionHtml } from "@/lib/shop/rich-description";
import { sanitizeSupplierCopy } from "@/lib/shop/sanitize";
import { getShopTargetMarginBps } from "@/lib/shop/settings";

/**
 * fk1.ybkjs.top mirror.
 *
 * The storefront is a static HTML catalogue: every page embeds the same
 * `catalog-data` JSON, and the site also serves that JSON at
 * /static/catalog.json. One request returns the whole shop, so the sync never
 * needs to walk item pages. Titles, copy, prices and stock come from the
 * public catalogue; fulfilment is manual and the supplier is never named in
 * buyer-facing text or public slugs.
 */

export const YBKJS_SOURCE = {
  /** shop_suppliers.kind and shop_offers external_key namespace. */
  kind: "ybkjs",
  base: "https://fk1.ybkjs.top",
  /** Neutral public slug prefix; "m-" carries no supplier identity. */
  slugPrefix: "m-",
} as const;

const FEED_URL = `${YBKJS_SOURCE.base}/static/catalog.json`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/**
 * Passed to sanitizeSupplierCopy so the shop's own name is rewritten to our
 * store name. It is never written to a product field directly.
 */
const SUPPLIER_IDENTITY = {
  store: "月饼科技社",
  url: YBKJS_SOURCE.base,
} as const;

export type YbkjsItem = {
  id: number;
  name: string;
  price: number | string;
  stock?: number | string | null;
  sold?: number | string;
  cover?: string;
  category: string;
  detail: string;
};

export type YbkjsProduct = {
  externalId: string;
  title: string;
  costMicros: number;
  availability: "in_stock" | "low_stock" | "out_of_stock";
  url: string;
  description: string;
  descriptionHtml: string;
  brand: "chatgpt" | "claude" | "gemini" | "grok" | "muse" | "other";
  category: "subscription" | "account" | "topup" | "giftcard";
  slug: string;
  displayCategory: string;
  coverUrl: string | null;
  warrantyType: "first_login" | "days" | "none";
  warrantyDays: number;
  warrantyNote: string;
  /** Upstream cumulative sold units. */
  supplierSold: number;
  /** Upstream stock on hand; 0 stays listed as out of stock. */
  supplierStock: number;
};

export type YbkjsSyncResult = {
  supplierId: string;
  itemsSeen: number;
  imported: number;
  skipped: { id: number; reason: string }[];
  /** Products paused because they disappeared from the upstream catalogue. */
  delisted?: number;
};

export type YbkjsSyncOptions = {
  limit?: number;
  dryRun?: boolean;
};

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return await response.text();
      if (response.status < 500) throw new Error(`${url} -> ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw new Error(`无法获取 ${url}`);
}

/**
 * Flattens the public catalogue. Accepts both the standalone JSON and the
 * `catalog-data` script shape used on the homepage.
 */
export function parseCatalogJson(raw: string): YbkjsItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ybkjs 目录不是合法 JSON");
  }
  const catalog = (parsed as { catalog?: unknown }).catalog;
  if (!Array.isArray(catalog)) throw new Error("ybkjs 目录缺少 catalog 数组");

  const items: YbkjsItem[] = [];
  for (const category of catalog) {
    const entry = category as { id?: unknown; name?: unknown; items?: unknown };
    const categoryName = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!Array.isArray(entry.items)) continue;
    for (const row of entry.items) {
      const item = row as {
        id?: unknown;
        name?: unknown;
        price?: unknown;
        stock?: unknown;
        sold?: unknown;
        cover?: unknown;
        extra?: { detail?: unknown } | null;
      };
      const id = Number(item.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const price = item.price;
      if (typeof price !== "number" && typeof price !== "string") continue;
      items.push({
        id,
        name: typeof item.name === "string" ? item.name : "",
        price,
        stock:
          typeof item.stock === "number" || typeof item.stock === "string" || item.stock === null
            ? item.stock
            : undefined,
        sold: typeof item.sold === "number" || typeof item.sold === "string" ? item.sold : 0,
        cover: typeof item.cover === "string" ? item.cover : undefined,
        category: categoryName,
        detail: typeof item.extra?.detail === "string" ? item.extra.detail : "",
      });
    }
  }
  return items;
}

async function loadCatalog(): Promise<YbkjsItem[]> {
  return parseCatalogJson(await fetchText(FEED_URL));
}

/** Supplier-only sales talk and contact handles, removed from buyer copy. */
function scrubCopy(input: string): string {
  if (!input) return "";
  return sanitizeSupplierCopy(input, SUPPLIER_IDENTITY)
    // The brand pass rewrites "ybkjs666" to our store name plus the digits,
    // leaving "CokeAI 小店666" behind. That is a contact handle, not a name.
    .replace(/CokeAI\s*小店\s*\d+/gi, "本店客服")
    .replace(/小店\s*\d{3,}/g, "本店客服")
    .replace(/客服\s*本店客服/g, "本店客服")
    .replace(/客服本店客服/g, "本店客服")
    .replace(/微信/g, "本店客服")
    .replace(/本店客服\s*本店客服/g, "本店客服")
    .replace(/添加本店客服/g, "联系本店客服")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanTitle(raw: string): string {
  return scrubCopy(raw)
    // "官网直充" is the supplier's sourcing claim; the product is still a
    // top-up, so keep the noun and drop the provenance.
    .replace(/官网直充/g, "直充")
    .replace(/官方直充/g, "直充")
    .replace(/官方\s*(?:正品|充值|代充)/g, "充值")
    .replace(/[（(]\s*[，,、]?\s*[）)]/g, "")
    .replace(/[，,]{2,}/g, "，")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}

/** Non-sellable catalogue rows: tutorials, announcements and price top-ups. */
const NON_SELLABLE = /教程|公告|通知|补差价|差价专用|非卖品|测试|占位/;

function detectBrand(
  category: string,
  title: string,
): YbkjsProduct["brand"] {
  const scope = `${category} ${title}`;
  if (/全家桶|五大\s*AI/i.test(scope)) return "other";
  if (/muse/i.test(category)) return "muse";
  if (/gemini|谷歌/i.test(category) && !/邮箱|接码/i.test(category)) return "gemini";
  if (/chatgpt|gpt|openai/i.test(category)) return "chatgpt";
  if (/claude|anthropic/i.test(category)) return "claude";
  if (/grok/i.test(category)) return "grok";

  if (/muse/i.test(title)) return "muse";
  if (/claude|anthropic/i.test(title) && !/gemini|gpt/i.test(title)) return "claude";
  if (/grok/i.test(title)) return "grok";
  if (/gemini|谷歌\s*(?:pro|ultra)|antigravity|反重力/i.test(title) && !/邮箱|接码/i.test(title)) {
    return "gemini";
  }
  if (/gpt|chatgpt|codex|openai|sora/i.test(title)) return "chatgpt";
  return "other";
}

// Canonical labels understood by lib/shop/categories.ts. Only ChatGPT, Claude,
// Gemini, Grok, 邮箱 and 接码 have rail entries; everything else is 其他.
const DISPLAY_CATEGORY: Record<string, string> = {
  Gemini: "Gemini",
  ChatGPT: "ChatGPT",
  Claude: "Claude",
  SuperGrok: "Grok",
  "Google 邮箱": "邮箱",
  SMS接码: "接码",
  "perplexity pro": "其他",
  "AI全家桶（五ai）": "其他",
  "奈飞Netflix": "其他",
  "迪士尼Disney": "其他",
  "API key": "其他",
  "visa卡-仅用于gemini绑卡！": "其他",
  Sora2: "其他",
  "Notion AI": "其他",
  Manus: "其他",
  "Cursor Pro": "其他",
  MuseAI: "其他",
  "补差价专用": "其他",
};

function displayCategoryOf(category: string, brand: YbkjsProduct["brand"]): string {
  const known = DISPLAY_CATEGORY[category.trim()];
  if (known) return known;
  if (brand === "chatgpt") return "ChatGPT";
  if (brand === "claude") return "Claude";
  if (brand === "gemini") return "Gemini";
  if (brand === "grok") return "Grok";
  return normalizeDisplayCategory(category);
}

function detectCategory(
  title: string,
  category: string,
): YbkjsProduct["category"] {
  if (/接码|邀请码|apikey|api\s*key|兑换码|卡密|visa\s*卡|礼品卡/i.test(title)) {
    return "giftcard";
  }
  if (/成品号|账号|邮箱|普号/i.test(title)) return "account";
  if (/直充|代充|充值/i.test(title)) return "topup";
  if (/邮箱/i.test(category)) return "account";
  return "subscription";
}

const CN_NUMBER: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function numberOf(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  return CN_NUMBER[raw] ?? 0;
}

const NO_WARRANTY = /无售后|无质保|不质保|不包售后/;

function noWarranty(): Pick<YbkjsProduct, "warrantyType" | "warrantyDays" | "warrantyNote"> {
  return {
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "商品说明标注无售后，请下单前确认。",
  };
}

function detectWarranty(
  text: string,
): Pick<YbkjsProduct, "warrantyType" | "warrantyDays" | "warrantyNote"> {
  if (!text) {
    return {
      warrantyType: "none",
      warrantyDays: 0,
      warrantyNote: "质保以商品说明为准，下单前请阅读商品说明。",
    };
  }
  if (NO_WARRANTY.test(text)) return noWarranty();
  if (/质保首登|首登质保/.test(text)) {
    return {
      warrantyType: "first_login",
      warrantyDays: 0,
      warrantyNote: "商品说明标注质保首次登录，以商品说明为准。",
    };
  }
  const years = text.match(/质保[^0-9一二两三四五六七八九十]{0,6}([1一])\s*年/);
  if (years) {
    return {
      warrantyType: "days",
      warrantyDays: 365,
      warrantyNote: "商品说明标注质保 1 年，以商品说明为准。",
    };
  }
  const months = text.match(
    /质保[^0-9一二两三四五六七八九十]{0,6}(\d+|[一二两三四五六七八九十])\s*个?\s*月/,
  );
  if (months && numberOf(months[1]) > 0) {
    const value = numberOf(months[1]);
    return {
      warrantyType: "days",
      warrantyDays: value * 30,
      warrantyNote: `商品说明标注质保 ${value} 个月，以商品说明为准。`,
    };
  }
  const days = text.match(
    /质保[^0-9一二两三四五六七八九十]{0,6}(\d+|[一二两三四五六七八九十])\s*天/,
  );
  if (days && numberOf(days[1]) > 0) {
    const value = numberOf(days[1]);
    return {
      warrantyType: "days",
      warrantyDays: value,
      warrantyNote: `商品说明标注质保 ${value} 天，以商品说明为准。`,
    };
  }
  if (/质保全程/.test(text)) {
    return {
      warrantyType: "days",
      warrantyDays: 30,
      warrantyNote: "商品说明标注质保全程，以商品说明为准。",
    };
  }
  return {
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "质保以商品说明为准，下单前请阅读商品说明。",
  };
}

/** The title's explicit term wins; the longer description fills the gaps. */
function warrantyOf(
  title: string,
  description: string,
): Pick<YbkjsProduct, "warrantyType" | "warrantyDays" | "warrantyNote"> {
  if (NO_WARRANTY.test(title)) return noWarranty();
  const fromTitle = detectWarranty(title);
  if (fromTitle.warrantyType !== "none") return fromTitle;
  if (NO_WARRANTY.test(description)) return noWarranty();
  return detectWarranty(description);
}

type StockReading = { units: number | null; abundant: boolean; tight: boolean };

/**
 * Only an explicit upstream number is a real count. "充足" means in stock with
 * no cap (-1 on the product row). An unreadable value cannot be sold as
 * available, so it is listed as out of stock instead of inventing a quantity.
 */
function readStock(value: unknown): StockReading {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { units: Math.max(0, Math.trunc(value)), abundant: false, tight: false };
  }
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) {
    const units = Number(text);
    return { units, abundant: false, tight: false };
  }
  if (/充足|无限|非常多|大量|爆棚/.test(text)) {
    return { units: null, abundant: true, tight: false };
  }
  if (/即将售罄|少量|紧张/.test(text)) {
    return { units: null, abundant: false, tight: true };
  }
  if (/售罄|缺货|无货|下架/.test(text)) {
    return { units: 0, abundant: false, tight: false };
  }
  return { units: null, abundant: false, tight: false };
}

function availabilityOfStock(stock: StockReading): YbkjsProduct["availability"] {
  if (stock.abundant) return "in_stock";
  if (stock.tight) return "low_stock";
  if (stock.units !== null && stock.units > 0) return "in_stock";
  return "out_of_stock";
}

/**
 * Public slugs must never identify the supplier. `m-` is a neutral product
 * number; the upstream id is in the slug only to keep it stable.
 */
function slugFor(
  id: number,
  brand: YbkjsProduct["brand"],
  title: string,
): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  // Avoid "m-1-gemini-gemini-pro" when the title already starts with the brand.
  const brandPart = brand !== "other" && !ascii.startsWith(brand) ? `-${brand}` : "";
  return `${YBKJS_SOURCE.slugPrefix}${id}${brandPart}${
    ascii ? `-${ascii}` : ""
  }`.slice(0, 80);
}

function absoluteCover(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value, YBKJS_SOURCE.base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function tierLabel(item: YbkjsItem, index: number): string {
  const period = item.name.match(
    /永久卡|两年卡|年卡|半年卡|季卡|月卡|周卡|\d+\s*(?:天|个月|年)/,
  )?.[0];
  if (period) return period.trim();
  if (item.category.trim()) return item.category.trim();
  return `方案 ${index + 1}`;
}

/**
 * Turns catalogue rows into product drafts. Duplicate titles collapse to one
 * product; the surviving product keeps the tier wording in its name. Upstream
 * uses separate ids per tier, so this is a guard against future duplicates,
 * not a grouping pass.
 */
export function toProducts(items: YbkjsItem[]): {
  products: YbkjsProduct[];
  skipped: { id: number; reason: string }[];
} {
  const skipped: { id: number; reason: string }[] = [];
  const candidates: Array<{ item: YbkjsItem; product: YbkjsProduct }> = [];

  for (const item of items) {
    const title = cleanTitle(item.name);
    if (!title) {
      skipped.push({ id: item.id, reason: "标题为空" });
      continue;
    }
    if (NON_SELLABLE.test(title) || NON_SELLABLE.test(item.category)) {
      skipped.push({ id: item.id, reason: "教程或非卖品条目" });
      continue;
    }
    const yuan = Number(item.price);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      skipped.push({ id: item.id, reason: "标价缺失或 ≤0" });
      continue;
    }

    const brand = detectBrand(item.category, title);
    const stock = readStock(item.stock);
    const supplierStock = stock.abundant ? -1 : (stock.units ?? 0);
    const description = scrubCopy(item.detail).slice(0, 6000);
    const text = description || "商品由本店人工采购交付，具体内容以下单页说明为准。";
    const richHtml = description
      ? buildRichDescriptionHtml(paragraphs(description), {
          base: YBKJS_SOURCE.base,
          identities: [SUPPLIER_IDENTITY],
        })
      : "";

    candidates.push({
      item,
      product: {
        externalId: `${YBKJS_SOURCE.kind}:${item.id}`,
        title,
        costMicros: Math.round(yuan * 1_000_000),
        availability: availabilityOfStock(stock),
        url: `${YBKJS_SOURCE.base}/item/${item.id}.html`,
        description: text,
        descriptionHtml: richHtml,
        brand,
        category: detectCategory(title, item.category),
        slug: slugFor(item.id, brand, title),
        displayCategory: displayCategoryOf(item.category, brand),
        coverUrl: absoluteCover(item.cover),
        ...warrantyOf(title, description),
        supplierSold: Math.max(0, Math.trunc(Number(item.sold ?? 0)) || 0),
        supplierStock,
      },
    });
  }

  const grouped = new Map<string, Array<{ item: YbkjsItem; product: YbkjsProduct }>>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.product.title) ?? [];
    list.push(candidate);
    grouped.set(candidate.product.title, list);
  }

  const used = new Set<string>();
  const products: YbkjsProduct[] = [];
  for (const [title, group] of grouped) {
    group.forEach((candidate, index) => {
      const base = group.length > 1
        ? `${title}（${tierLabel(candidate.item, index)}）`
        : title;
      let name = base;
      let suffix = 2;
      while (used.has(name)) {
        name = base.endsWith("）")
          ? `${base.slice(0, -1)} ${suffix++}）`
          : `${base}（${suffix++}）`;
      }
      used.add(name);
      products.push({ ...candidate.product, title: name });
    });
  }
  return { products, skipped };
}

async function ensureSupplier(): Promise<string> {
  const existing = await query<{ id: string }>(
    "SELECT id FROM shop_suppliers WHERE kind = $1 ORDER BY created_at LIMIT 1",
    [YBKJS_SOURCE.kind],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  try {
    return await insertSupplier();
  } catch (error) {
    // db/schema.sql pins shop_suppliers.kind to the suppliers known when the
    // constraint was written. This module is self-contained, so widen the
    // constraint the first time this supplier is seen instead of requiring a
    // separate migration file.
    if ((error as { code?: string }).code !== "23514") throw error;
    await allowSupplierKind();
    return await insertSupplier();
  }
}

async function insertSupplier(): Promise<string> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO shop_suppliers (name, kind, feed_url, meta_url)
     VALUES ($1, $1, $2, $3) RETURNING id`,
    [YBKJS_SOURCE.kind, FEED_URL, YBKJS_SOURCE.base],
  );
  return inserted.rows[0].id;
}

async function allowSupplierKind(): Promise<void> {
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'shop_suppliers'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%ybkjs%'
      ) THEN
        BEGIN
          ALTER TABLE shop_suppliers DROP CONSTRAINT IF EXISTS shop_suppliers_kind_check;
          ALTER TABLE shop_suppliers ADD CONSTRAINT shop_suppliers_kind_check
            CHECK (kind IN ('aibijia', 'manual', 'zyanai', 'aibuy', 'ybkjs', 'baipiao'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END IF;
    END $$;
  `);
}

export async function syncYbkjsProducts(
  options?: YbkjsSyncOptions,
): Promise<YbkjsSyncResult> {
  const supplierId = await ensureSupplier();
  const catalog = await loadCatalog();
  const seen = new Set<number>();
  const deduped: YbkjsItem[] = [];
  for (const item of catalog) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  const selected = options?.limit ? deduped.slice(0, options.limit) : deduped;
  const { products, skipped } = toProducts(selected);

  const result: YbkjsSyncResult = {
    supplierId,
    itemsSeen: selected.length,
    imported: 0,
    skipped: [...skipped],
  };

  const run = await query<{ id: string }>(
    `INSERT INTO shop_sync_runs (supplier_id, status) VALUES ($1, 'running') RETURNING id`,
    [supplierId],
  );
  const runId = run.rows[0].id;

  try {
    for (const product of products) {
      try {
        if (options?.dryRun) {
          result.imported += 1;
          continue;
        }
        await persistProduct(supplierId, product);
        result.imported += 1;
      } catch (error) {
        result.skipped.push({
          id: Number(product.externalId.split(":")[1] || 0),
          reason: error instanceof Error ? error.message.slice(0, 160) : "写入失败",
        });
      }
    }

    // 上游消失的商品：连续两次缺失才下架，避免列表抖动误伤。
    // 只有同步完整目录时判断，--limit 只同步前几件时其余商品本来就不在列表里。
    const fullCatalog = !options?.limit;
    const seenKeys = catalog.map((item) => `${YBKJS_SOURCE.kind}:${item.id}`);
    if (fullCatalog && seenKeys.length > 0) {
      await query(
        `UPDATE shop_offers
            SET missing_count = missing_count + 1,
                availability = CASE
                  WHEN missing_count + 1 >= 2 THEN 'missing'
                  ELSE availability
                END
          WHERE supplier_id = $1 AND NOT (external_key = ANY($2::text[]))`,
        [supplierId, seenKeys],
      );
      const delisted = await query<{ count: string }>(
        `WITH gone AS (
           UPDATE shop_products p
              SET status = 'paused',
                  availability = 'out_of_stock',
                  availability_reason = '货源已下架',
                  updated_at = now()
             FROM shop_product_sources s
             JOIN shop_offers o ON o.id = s.offer_id
            WHERE s.product_id = p.id
              AND o.supplier_id = $1
              AND o.availability = 'missing'
              AND p.status = 'active'
            RETURNING p.id
         )
         SELECT COUNT(*)::text AS count FROM gone`,
        [supplierId],
      );
      result.delisted = Number(delisted.rows[0]?.count || 0);
    }

    await query(
      `UPDATE shop_sync_runs
          SET status = $2, finished_at = now(), offers_seen = $3, mapped_offers = $4,
              details = $5::jsonb
        WHERE id = $1`,
      [
        runId,
        result.skipped.length === 0 ? "success" : "partial",
        result.itemsSeen,
        result.imported,
        JSON.stringify({ skipped: result.skipped, delisted: result.delisted ?? 0 }),
      ],
    );
    await query(
      `UPDATE shop_suppliers SET last_sync_at = now(), last_success_at = now(),
              last_error = NULL, updated_at = now() WHERE id = $1`,
      [supplierId],
    );
    return result;
  } catch (error) {
    await query(
      `UPDATE shop_sync_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
      [runId, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  }
}

async function persistProduct(supplierId: string, product: YbkjsProduct): Promise<void> {
  const retail = autoRetailPrice(product.costMicros, await getShopTargetMarginBps());
  const productId = await withTransaction(async (client) => {
    const offer = await client.query<{ id: string }>(
      `INSERT INTO shop_offers
         (supplier_id, external_key, supplier_product_slug, source_store, source_title,
          price_micros, availability, url, raw)
       VALUES ($1, $2, $3, $9, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (supplier_id, external_key) DO UPDATE
         SET source_title = EXCLUDED.source_title, price_micros = EXCLUDED.price_micros,
             availability = EXCLUDED.availability, url = EXCLUDED.url, raw = EXCLUDED.raw,
             missing_count = 0, last_seen_at = now()
       RETURNING id`,
      [
        supplierId,
        product.externalId,
        product.slug,
        product.title,
        product.costMicros,
        product.availability,
        product.url,
        JSON.stringify({ availability: product.availability }),
        YBKJS_SOURCE.kind,
      ],
    );
    const offerId = offer.rows[0].id;
    await client.query(
      `INSERT INTO shop_offer_price_history (offer_id, price_micros, availability)
       VALUES ($1, $2, $3)`,
      [offerId, product.costMicros, product.availability],
    );

    // A brand-rule change can produce a new slug for an offer that already has
    // a product. Reuse the linked product's slug so the live listing keeps
    // being the row this sync refreshes.
    const existing = await client.query<{ slug: string }>(
      `SELECT p.slug
         FROM shop_product_sources s
         JOIN shop_products p ON p.id = s.product_id
        WHERE s.offer_id = $1
          AND p.status <> 'archived'
        ORDER BY p.supplier_synced_at DESC NULLS LAST, p.updated_at DESC
        LIMIT 1`,
      [offerId],
    );
    const slug = existing.rows[0]?.slug || product.slug;

    const shopProduct = await client.query<{ id: string }>(
      `INSERT INTO shop_products
         (slug, brand, category, product_type, name, subtitle, description, cover_variant,
          price_micros, delivery_method, eta_min_minutes, eta_max_minutes,
          warranty_type, warranty_days, warranty_note, help_article_ids,
          display_category, status, availability, availability_reason,
          copy_ready, sort_order, published_at,
          supplier_sold, supplier_stock, supplier_synced_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$2,$7,'manual',15,60,$8,$9,$10,'[]'::jsonb,$11,'active',$12,$13,
               TRUE,$14, now(),
               $15, $16, now())
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
             description = EXCLUDED.description,
             price_micros = CASE
               WHEN shop_products.price_locked THEN shop_products.price_micros
               ELSE EXCLUDED.price_micros
             END,
             warranty_type = EXCLUDED.warranty_type,
             warranty_days = EXCLUDED.warranty_days,
             warranty_note = EXCLUDED.warranty_note,
             display_category = EXCLUDED.display_category,
             availability = EXCLUDED.availability,
             -- 货源库存/已售要扣掉「已卖给客户、还没向上游采购」的件数，
             -- 不然下一次同步会把库存刷回去。
             supplier_sold = EXCLUDED.supplier_sold + COALESCE((
               SELECT SUM(i.qty) FROM shop_order_items i
                WHERE i.product_id = shop_products.id
                  AND i.procurement_status IN ('pending', 'to_buy')
             ), 0),
             supplier_stock = CASE
               WHEN EXCLUDED.supplier_stock > 0 THEN GREATEST(0,
                 EXCLUDED.supplier_stock - COALESCE((
                   SELECT SUM(i.qty) FROM shop_order_items i
                    WHERE i.product_id = shop_products.id
                      AND i.procurement_status IN ('pending', 'to_buy')
                 ), 0))
               ELSE EXCLUDED.supplier_stock
             END,
             supplier_synced_at = now(),
             availability_reason = CASE
               WHEN EXCLUDED.availability_reason IS NOT NULL
                 THEN EXCLUDED.availability_reason
               WHEN shop_products.availability_reason = '补货中'
                 THEN NULL
               ELSE shop_products.availability_reason
             END,
             -- 运营手动暂停/归档的商品，定时同步不能把它重新上架。
             published_at = COALESCE(shop_products.published_at, EXCLUDED.published_at),
             updated_at = now()
       RETURNING id`,
      [
        slug,
        product.brand,
        product.category,
        product.title,
        "人工交付 · 以商品说明为准",
        product.description,
        retail,
        product.warrantyType,
        product.warrantyDays,
        product.warrantyNote,
        product.displayCategory,
        product.availability,
        product.availability === "out_of_stock" ? "补货中" : null,
        900 + Math.round(Number(product.externalId.split(":")[1] || 0) / 1000),
        product.supplierSold,
        product.supplierStock,
      ],
    );
    const id = shopProduct.rows[0].id;

    await client.query(
      `INSERT INTO shop_product_sources
         (product_id, offer_id, role, active, supplier_cost_micros, supplier_availability, last_synced_at)
       VALUES ($1, $2, 'primary', TRUE, $3, $4, now())
       ON CONFLICT (product_id, offer_id) DO UPDATE
         SET active = TRUE, supplier_cost_micros = EXCLUDED.supplier_cost_micros,
             supplier_availability = EXCLUDED.supplier_availability, last_synced_at = now()`,
      [id, offerId, product.costMicros, product.availability],
    );

    return id;
  });

  // Best effort: mirroring a supplier cover must never fail the sync. On a
  // download failure the product simply keeps no cover instead of hotlinking.
  const imageMap = await replaceProductImages(productId, {
    coverUrl: product.coverUrl,
  });

  try {
    const richHtml = product.descriptionHtml
      ? buildRichDescriptionHtml(product.descriptionHtml, {
          imageMap,
          base: YBKJS_SOURCE.base,
          identities: [SUPPLIER_IDENTITY],
        })
      : "";
    if (richHtml) {
      await query("UPDATE shop_products SET description_html = $2 WHERE id = $1", [
        productId,
        richHtml,
      ]);
    }
  } catch (error) {
    console.warn(
      `[shop/${YBKJS_SOURCE.kind}] 商品 ${product.externalId} 富文本排版失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
