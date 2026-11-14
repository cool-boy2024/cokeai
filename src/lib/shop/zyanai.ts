import { config } from "@/lib/config";
import { query, withTransaction } from "@/lib/db";
import { suggestRetailPrice } from "@/lib/shop/catalog";
import { replaceProductImages } from "@/lib/shop/images";
import { extractReadableText } from "@/lib/shop/readable";
import { buildRichDescriptionHtml } from "@/lib/shop/rich-description";
import { sanitizeSupplierCopy } from "@/lib/shop/sanitize";

/**
 * zyanai.cc mirror.
 *
 * The supplier exposes a public JSON list and a public item page. We copy the
 * offer (title, price, stock) and the factual product description. Product
 * images are mirrored into our own storage (shop_images) and served from our
 * own domain, so the shop never hotlinks the supplier. Contact handles and
 * wholesale tiers are still stripped. Purchases stay manual: an operator buys
 * the matching item on zyanai after our order is paid.
 */

const BASE = "https://zyanai.cc";
const LIST_URL = `${BASE}/user/api/index/commodity?limit=100&page=1`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export type ZyanaiItem = {
  id: number;
  name: string;
  price: string;
  tags?: string;
  stock?: string;
  status?: number;
  hide?: number;
  cover?: string;
  category_id?: number;
  category?: { id?: number; name?: string } | null;
  delivery_way?: number;
};

export type ZyanaiProduct = {
  externalId: string;
  title: string;
  costMicros: number;
  availability: "in_stock" | "low_stock" | "out_of_stock";
  url: string;
  description: string;
  /** Original description markup, mirrored and scrubbed before it is stored. */
  descriptionHtml: string;
  tags: string[];
  warrantyType: "first_login" | "days" | "none";
  warrantyDays: number;
  warrantyNote: string;
  brand: "chatgpt" | "claude" | "gemini" | "grok" | "muse" | "other";
  category: "subscription" | "account" | "topup" | "giftcard";
  slug: string;
  displayCategory: string;
  coverUrl: string | null;
  imageUrls: { url: string; alt: string }[];
  helpArticleIds: string[];
};

export type ZyanaiSyncResult = {
  supplierId: string;
  itemsSeen: number;
  imported: number;
  skipped: { id: number; reason: string }[];
};

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
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

function scanJson(html: string, marker: string): unknown | null {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const objectStart = html.indexOf("{", start);
  if (objectStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = objectStart; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(objectStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const IMG_SRC_PATTERN = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HELP_ARTICLE_PATTERN = /\/user\/help\/(article\.\d+)/g;
const MAX_DESCRIPTION_IMAGES = 8;

/** Resolves a supplier-relative URL and keeps only public web protocols. */
function absoluteHttpUrl(raw: string, base: string): string | null {
  const trimmed = raw.trim().replace(/&amp;/g, "&");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractImageUrls(descriptionHtml: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of descriptionHtml.matchAll(IMG_SRC_PATTERN)) {
    const resolved = absoluteHttpUrl(match[1] ?? "", BASE);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
    if (urls.length >= MAX_DESCRIPTION_IMAGES) break;
  }
  return urls;
}

function extractHelpArticleIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(HELP_ARTICLE_PATTERN)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function parseItemPage(html: string): {
  item: ZyanaiItem | null;
  descriptionHtml: string;
  imageUrls: string[];
  helpArticleIds: string[];
} {
  const item = scanJson(html, 'setVar("_var_item"') as ZyanaiItem | null;
  // The class list varies between themes, so anchor on the token rather than
  // the full class attribute.
  const marker = html.indexOf("tokyo-description-body");
  let descriptionHtml = "";
  if (marker >= 0) {
    const contentStart = html.indexOf(">", marker) + 1;
    const sectionEnd = html.indexOf("</section>", contentStart);
    descriptionHtml = html.slice(
      contentStart,
      sectionEnd > 0 ? sectionEnd : contentStart + 50_000,
    );
  }
  return {
    item,
    descriptionHtml,
    imageUrls: extractImageUrls(descriptionHtml),
    helpArticleIds: extractHelpArticleIds(html),
  };
}

export function availabilityOf(stock: unknown): "in_stock" | "low_stock" | "out_of_stock" {
  // A few items return stock as a number or object instead of a string.
  const text = String(stock ?? "").trim();
  if (/售罄|缺货|无货|下架/.test(text)) return "out_of_stock";
  if (/即将售罄|少量|紧张/.test(text)) return "low_stock";
  if (/充足|非常多|一般|有货|爆棚|无限|充足/.test(text)) return "in_stock";
  if (/^\d+$/.test(text)) return Number(text) > 0 ? "in_stock" : "out_of_stock";
  return text ? "in_stock" : "out_of_stock";
}

/** Strip claims we cannot stand behind and supplier-only sales talk. */
export function scrubZyanaiCopy(input: string): string {
  let text = sanitizeSupplierCopy(input, { store: "zyanai", url: BASE });
  text = text
    .replace(/100\s*%\s*(?:可用|有效|成功|稳定|靠谱)/gi, "可用")
    .replace(/百分百\s*(?:可用|有效|成功)/gi, "可用")
    .replace(/保证\s*正规充值！?/g, "")
    .replace(/绝对\s*(?:稳定|可靠|安全|好用)/gi, "稳定")
    .replace(/永久\s*(?:可用|有效|使用)/gi, "长期可用")
    .replace(/唯一/gi, "")
    .replace(/保证(?:你)?(?:一定)?(?:可用|有效|能用|不掉线)/g, "通常可用")
    .replace(/\b1[3-9]\d{9}\b/g, "")
    // Delivered manually: the supplier's auto-delivery wording would promise
    // something our own order flow does not do.
    .replace(/下单付款后[，,]?\s*系统会自动显示充值卡密。?/g, "付款后由本店人工完成采购，卡密会显示在你的订单详情页。")
    .replace(/本商品为\s*CDK\s*自动发货\s*。?/g, "本商品为 CDK 卡密商品。")
    .replace(/下单自动发\s*CDK[，,]?\s*不用等待人工发货/g, "付款后由本店人工采购发货，进度可在订单页查看")
    // Refund arithmetic is the supplier's settlement, not ours.
    .replace(
      /如果退款成功[\s\S]{0,240}?不提供退款话术或代申请服务。?/g,
      "如遇账号封禁，请以官方退款政策为准；本店不代申请，也不承诺退款结果。",
    )
    .replace(/发货内容为\s*CDK\s*卡密\s*[，,]\s*卡密本身不会过期。[^\n]*/g, "发货内容为 CDK 卡密，卡密本身不会过期。")
    .replace(/%2B/gi, "+");
  const blocked =
    /(?:批发|代理价|分销|合伙人|会员价|拿货|进价|成本价|内部价|优惠券|邀请码|返佣|推广|拉新|加群|进群|联系站长|联系店主|80%\s*结算|卡台手续费|退款话术|代申请服务)/;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !blocked.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanTitle(raw: string): string {
  let title = scrubZyanaiCopy(raw)
    // "Official", "guaranteed" and "lowest price" are the supplier's claims,
    // not something we can verify. Keep the product, drop the sales talk.
    .replace(/官方\s*直充/g, "直充")
    .replace(/保证\s*正规充值！?/g, "")
    .replace(/真实付费开通！?/g, "")
    .replace(/官方\s*正规充值/g, "充值")
    .replace(/官方\s*(?:代充值|充值)/g, "充值")
    .replace(/正规\s*充值/g, "充值")
    .replace(/官方\s*(?:订阅|正品)/g, "")
    .replace(/已降最低价/g, "")
    .replace(/半价\s*优惠/g, "")
    .replace(/超高权重！?/g, "")
    .replace(/cdk\s*自动充值/gi, "CDK 卡密")
    .replace(/\s+/g, " ")
    .trim();
  // A now-empty bracket or a dangling separator is noise.
  title = title
    .replace(/[（(]\s*[，,、]?\s*[）)]/g, "")
    .replace(/[【［]\s*[】］]/g, "")
    .replace(/[（(]\s*([^（）()]*?)[，,、]\s*[）)]/g, "（$1）")
    .replace(/[「『]\s*([^」』]*?)[，,、]\s*[」』]/g, "「$1」")
    .replace(/[，,]{2,}/g, "，")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Drop the marketing parenthetical the supplier appends to many titles.
  if (title.length > 60 && /[（(]/.test(title)) {
    const short = title.replace(/[（(][^）)]{8,}[）)]\s*$/, "").trim();
    if (short.length >= 6) title = short;
  }
  return title.slice(0, 120);
}

function detectBrand(title: string): ZyanaiProduct["brand"] {
  if (/muse/i.test(title)) return "muse";
  if (/claude|anthropic/i.test(title) && !/gemini|gpt/i.test(title)) return "claude";
  if (/grok/i.test(title)) return "grok";
  if (/gemini|谷歌\s*(?:pro|ultra|ulrta|会员|家庭组)|antigravity|反重力|colab/i.test(title) && !/邮箱|接码/i.test(title)) {
    return "gemini";
  }
  if (/gpt|chatgpt|codex|openai/i.test(title)) return "chatgpt";
  return "other";
}

const DISPLAY_CATEGORY: Record<string, string> = {
  "GPT（pro额度全体翻倍）": "GPT",
  谷歌: "谷歌",
  "GROK-推特X-cursor": "Grok",
  Claude: "Claude",
  设计类AI: "设计类 AI",
  CapCut: "CapCut",
  "youtube-油管": "YouTube",
  suno: "Suno",
  Autodesk: "Autodesk",
  heygen: "HeyGen",
};

function displayCategoryOf(item: ZyanaiItem): string {
  const name = item.category?.name?.trim() || "";
  return DISPLAY_CATEGORY[name] || "其他";
}

function detectCategory(title: string): ZyanaiProduct["category"] {
  if (/cdk|卡密|兑换码/i.test(title)) return "giftcard";
  if (/成品账号|账号|号\b|普号|邮箱/i.test(title)) return "account";
  if (/充值|直充|代充|代开|开通|点数/i.test(title)) return "topup";
  return "subscription";
}

function detectWarranty(text: string): Pick<ZyanaiProduct, "warrantyType" | "warrantyDays" | "warrantyNote"> {
  if (/无售后|无质保|不质保/.test(text)) {
    return { warrantyType: "none", warrantyDays: 0, warrantyNote: "商品说明标注无售后，请下单前确认。" };
  }
  if (/质保首登|首登质保/.test(text)) {
    return { warrantyType: "first_login", warrantyDays: 0, warrantyNote: "商品说明标注质保首次登录，以商品介绍为准。" };
  }
  const years = text.match(/质保\s*(?:1|一)\s*年/);
  if (years) return { warrantyType: "days", warrantyDays: 365, warrantyNote: "商品说明标注质保 1 年，以商品介绍为准。" };
  const months = text.match(/质保\s*(\d+)\s*个?月/);
  if (months) {
    const days = Number(months[1]) * 30;
    return { warrantyType: "days", warrantyDays: days, warrantyNote: `商品说明标注质保 ${months[1]} 个月，以商品介绍为准。` };
  }
  const days = text.match(/质保\s*(\d+)\s*天/);
  if (days) return { warrantyType: "days", warrantyDays: Number(days[1]), warrantyNote: `商品说明标注质保 ${days[1]} 天，以商品介绍为准。` };
  if (/质保全程/.test(text)) {
    return { warrantyType: "days", warrantyDays: 30, warrantyNote: "商品说明标注质保全程，以商品介绍为准。" };
  }
  return { warrantyType: "none", warrantyDays: 0, warrantyNote: "质保以商品介绍为准，下单前请阅读商品说明。" };
}

function slugFor(id: number, brand: string, title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `zy-${id}${brand !== "other" ? `-${brand}` : ""}${ascii ? `-${ascii}` : ""}`.slice(0, 80);
}

function imageAlt(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return name || "商品说明图片";
  } catch {
    return "商品说明图片";
  }
}

export function toProduct(
  item: ZyanaiItem,
  descriptionHtml: string,
  extras?: { imageUrls?: string[]; helpArticleIds?: string[] },
): ZyanaiProduct {
  const title = cleanTitle(item.name || "");
  const rawDescription = scrubZyanaiCopy(extractReadableText(descriptionHtml));
  // Some listings ship almost no copy; a short but useful note beats an empty
  // section on the product page.
  const description = (
    rawDescription.length >= 40
      ? rawDescription
      : "本商品由本店人工采购交付，发货进度可在订单详情页查看。下单前请阅读商品说明与保障信息，如有疑问可先联系本店。"
  ).slice(0, 6000);
  const tags = String(item.tags || "")
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag && !/(?:批发|代理|分销|合伙人|会员价|拿货|进价|成本|内部价|邀请)/.test(tag));
  const text = [title, tags.join(","), description].join("\n");
  const brand = detectBrand(title);
  const category = detectCategory(title);
  const imageUrls = (extras?.imageUrls ?? [])
    .slice(0, MAX_DESCRIPTION_IMAGES)
    .map((url) => ({ url, alt: imageAlt(url) }));
  return {
    externalId: `zyanai:${item.id}`,
    title,
    costMicros: Math.max(0, Math.round(Number(item.price || "0") * 1_000_000)),
    availability: availabilityOf(item.stock),
    url: `${BASE}/item/${item.id}`,
    description,
    descriptionHtml: descriptionHtml.slice(0, 80_000),
    tags,
    brand,
    category,
    slug: slugFor(item.id, brand, title),
    displayCategory: displayCategoryOf(item),
    coverUrl: item.cover ? absoluteHttpUrl(item.cover, BASE) : null,
    imageUrls,
    helpArticleIds: extras?.helpArticleIds ?? [],
    ...detectWarranty(text),
  };
}

async function ensureSupplier(): Promise<string> {
  const existing = await query<{ id: string }>(
    "SELECT id FROM shop_suppliers WHERE kind = 'zyanai' ORDER BY created_at LIMIT 1",
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await query<{ id: string }>(
    `INSERT INTO shop_suppliers (name, kind, feed_url, meta_url)
     VALUES ('zyanai', 'zyanai', $1, $2) RETURNING id`,
    [LIST_URL, BASE],
  );
  return inserted.rows[0].id;
}

async function loadCatalog(): Promise<ZyanaiItem[]> {
  const raw = await fetchText(LIST_URL);
  const parsed = JSON.parse(raw) as { code?: number; data?: ZyanaiItem[] };
  if (parsed.code !== 200 || !Array.isArray(parsed.data)) {
    throw new Error("zyanai 商品列表格式不正确");
  }
  return parsed.data.filter((item) => item.status === 1 && item.hide !== 1);
}

export async function syncZyanaiProducts(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<ZyanaiSyncResult> {
  const supplierId = await ensureSupplier();
  const catalog = await loadCatalog();
  const selected = options?.limit ? catalog.slice(0, options.limit) : catalog;
  const result: ZyanaiSyncResult = {
    supplierId,
    itemsSeen: catalog.length,
    imported: 0,
    skipped: [],
  };

  const run = await query<{ id: string }>(
    `INSERT INTO shop_sync_runs (supplier_id, status) VALUES ($1, 'running') RETURNING id`,
    [supplierId],
  );
  const runId = run.rows[0].id;

  try {
    for (const item of selected) {
      try {
        const page = await fetchText(`${BASE}/item/${item.id}`);
        const parsed = parseItemPage(page);
        const merged: ZyanaiItem = { ...item, ...(parsed.item || {}), id: item.id };
        if (merged.status !== 1 || merged.hide === 1) {
          result.skipped.push({ id: item.id, reason: "下架" });
          continue;
        }
        const product = toProduct(merged, parsed.descriptionHtml, {
          imageUrls: parsed.imageUrls,
          helpArticleIds: parsed.helpArticleIds,
        });
        if (!product.title || product.costMicros <= 0) {
          result.skipped.push({ id: item.id, reason: "标题或价格为空" });
          continue;
        }
        if (options?.dryRun) {
          result.imported += 1;
          continue;
        }
        await persistProduct(supplierId, product);
        result.imported += 1;
      } catch (error) {
        result.skipped.push({
          id: item.id,
          reason: error instanceof Error ? error.message.slice(0, 160) : "抓取失败",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
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
        JSON.stringify({ skipped: result.skipped }),
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

async function persistProduct(supplierId: string, product: ZyanaiProduct): Promise<void> {
  const retail = suggestRetailPrice(product.costMicros, config.shopImportTargetMarginBps);
  const productId = await withTransaction(async (client) => {
    const offer = await client.query<{ id: string; price_micros: string }>(
      `INSERT INTO shop_offers
         (supplier_id, external_key, supplier_product_slug, source_store, source_title,
          price_micros, availability, url, raw)
       VALUES ($1, $2, $3, 'zyanai', $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (supplier_id, external_key) DO UPDATE
         SET source_title = EXCLUDED.source_title, price_micros = EXCLUDED.price_micros,
             availability = EXCLUDED.availability, url = EXCLUDED.url, raw = EXCLUDED.raw,
             missing_count = 0, last_seen_at = now()
       RETURNING id, price_micros`,
      [
        supplierId,
        product.externalId,
        product.slug,
        product.title,
        product.costMicros,
        product.availability,
        product.url,
        JSON.stringify({ tags: product.tags }),
      ],
    );
    const offerId = offer.rows[0].id;
    await client.query(
      `INSERT INTO shop_offer_price_history (offer_id, price_micros, availability)
       VALUES ($1, $2, $3)`,
      [offerId, product.costMicros, product.availability],
    );

    const shopProduct = await client.query<{ id: string }>(
      `INSERT INTO shop_products
         (slug, brand, category, product_type, name, subtitle, description, cover_variant,
          price_micros, delivery_method, eta_min_minutes, eta_max_minutes,
          warranty_type, warranty_days, warranty_note, help_article_ids,
          display_category, status, availability, copy_ready, sort_order, published_at)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$2,$7,'manual',15,60,$8,$9,$10,$13::jsonb,$14,'active',$11,TRUE,$12,
               CASE WHEN $11 = 'out_of_stock' THEN NULL ELSE now() END)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
             description = EXCLUDED.description, price_micros = EXCLUDED.price_micros,
             warranty_type = EXCLUDED.warranty_type,
             warranty_days = EXCLUDED.warranty_days,
             warranty_note = EXCLUDED.warranty_note,
             help_article_ids = EXCLUDED.help_article_ids,
             display_category = EXCLUDED.display_category,
             availability = EXCLUDED.availability,
             -- Operators pause or archive a product on purpose. A scheduled
             -- supply sync may refresh copy and price, but it must never put
             -- a product they took down back on sale.
             published_at = COALESCE(shop_products.published_at, EXCLUDED.published_at),
             updated_at = now()
       RETURNING id`,
      [
        product.slug,
        product.brand,
        product.category,
        product.title,
        product.tags.slice(0, 3).join(" · ") || "人工交付 · 以商品说明为准",
        product.description,
        retail,
        product.warrantyType,
        product.warrantyDays,
        product.warrantyNote,
        product.availability,
        900 + Math.round(Number(product.externalId.split(":")[1] || 0) / 1000),
        JSON.stringify(product.helpArticleIds),
        product.displayCategory,
      ],
    );
    const productId = shopProduct.rows[0].id;

    await client.query(
      `INSERT INTO shop_product_sources
         (product_id, offer_id, role, active, supplier_cost_micros, supplier_availability, last_synced_at)
       VALUES ($1, $2, 'primary', TRUE, $3, $4, now())
       ON CONFLICT (product_id, offer_id) DO UPDATE
         SET active = TRUE, supplier_cost_micros = EXCLUDED.supplier_cost_micros,
             supplier_availability = EXCLUDED.supplier_availability, last_synced_at = now()`,
      [productId, offerId, product.costMicros, product.availability],
    );

    return productId;
  });

  // Best effort: mirroring supplier images must never fail the product sync.
  // replaceProductImages swallows its own errors and keeps old rows when every
  // download fails. Its mapping lets inline article images point at our copy.
  const imageMap = await replaceProductImages(productId, {
    coverUrl: product.coverUrl,
    images: product.imageUrls,
  });

  try {
    const richHtml = buildRichDescriptionHtml(product.descriptionHtml, {
      imageMap,
      base: BASE,
      identities: [{ store: "zyanai", url: BASE }],
    });
    if (richHtml) {
      await query("UPDATE shop_products SET description_html = $2 WHERE id = $1", [
        productId,
        richHtml,
      ]);
    }
  } catch (error) {
    // The plain-text description remains the fallback; never fail the sync
    // because a formatting pass rejected one page.
    console.warn(
      `[shop/zyanai] 商品 ${product.externalId} 富文本排版失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
