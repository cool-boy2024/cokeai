import { query, withTransaction } from "@/lib/db";
import { autoRetailPrice } from "@/lib/shop/auto-pricing";
import { normalizeDisplayCategory } from "@/lib/shop/categories";
import { getShopTargetMarginBps } from "@/lib/shop/settings";
import { normalizeSupplierStock } from "@/lib/shop/sales-display";
import { replaceProductImages } from "@/lib/shop/images";
import {
  PREORDER_MARKER,
  hasActiveReservationNotice,
  isPreorderStock,
} from "@/lib/shop/preorder";
import { extractReadableText } from "@/lib/shop/readable";
import { buildRichDescriptionHtml } from "@/lib/shop/rich-description";
import { sanitizeSupplierCopy } from "@/lib/shop/sanitize";

/**
 * Tokyo-theme supplier mirrors (zyanai.cc, ai-buy.vip).
 *
 * Both shops run the same storefront software: a public JSON list at
 * /user/api/index/commodity and a public item page carrying
 * setVar("_var_item", {...}). We copy the offer (title, price, stock) and the
 * factual product description. Product images are mirrored into our own
 * storage (shop_images) and served from our own domain, so the shop never
 * hotlinks a supplier. Contact handles and wholesale tiers are still stripped.
 * Purchases stay manual: an operator buys the matching item upstream after our
 * order is paid.
 */

export type TokyoSource = {
  /** shop_suppliers.kind and shop_offers external_key namespace. */
  kind: "zyanai" | "aibuy";
  base: string;
  /** Neutral public slug prefix; must never identify the supplier. */
  slugPrefix: string;
};

export const ZYANAI_SOURCE: TokyoSource = {
  kind: "zyanai",
  base: "https://zyanai.cc",
  slugPrefix: "p-",
};

export const AIBUY_SOURCE: TokyoSource = {
  kind: "aibuy",
  base: "https://ai-buy.vip",
  slugPrefix: "q-",
};

const BASE = ZYANAI_SOURCE.base;
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
  /** 上游累计已售件数（含我们自己的采购，不会重复计数）。 */
  order_sold?: number | string;
  category_id?: number;
  category?: { id?: number; name?: string } | null;
  delivery_way?: number;
  /** Detail-page JSON; absent on list rows and on soft-404 pages. */
  stock_raw?: unknown;
  is_stock?: unknown;
  stock_state?: unknown;
  reservation_enabled?: unknown;
};

export type ZyanaiProduct = {
  externalId: string;
  title: string;
  costMicros: number;
  availability: "in_stock" | "low_stock" | "out_of_stock";
  /** Supplier sells this listing as a preorder (库存不足，可预订). */
  preorder: boolean;
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
  /** 上游累计已售，直接展示。 */
  supplierSold: number;
  /** 上游当前库存；-1 = 充足，0 = 断货。 */
  supplierStock: number;
};

export type ZyanaiSyncResult = {
  supplierId: string;
  itemsSeen: number;
  imported: number;
  skipped: { id: number; reason: string }[];
  /** 这次同步里发现已从上游消失、因而下架的商品数。 */
  delisted?: number;
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

function extractImageUrls(descriptionHtml: string, base: string = BASE): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of descriptionHtml.matchAll(IMG_SRC_PATTERN)) {
    const resolved = absoluteHttpUrl(match[1] ?? "", base);
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

export function parseItemPage(
  html: string,
  base: string = BASE,
): {
  item: ZyanaiItem | null;
  descriptionHtml: string;
  imageUrls: string[];
  helpArticleIds: string[];
  /** The page actually renders the reservation banner as active. */
  reservationActive: boolean;
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
    imageUrls: extractImageUrls(descriptionHtml, base),
    helpArticleIds: extractHelpArticleIds(html),
    reservationActive: hasActiveReservationNotice(html),
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
export function scrubZyanaiCopy(
  input: string,
  source: TokyoSource = ZYANAI_SOURCE,
): string {
  let text = sanitizeSupplierCopy(input, { store: source.kind, url: source.base });
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

function detectBrandFromCategory(name: string | undefined): ZyanaiProduct["brand"] | null {
  const text = (name || "").trim();
  if (!text) return null;
  if (/claude|anthropic/i.test(text)) return "claude";
  if (/grok/i.test(text)) return "grok";
  if (/gemini|google|谷歌/i.test(text)) return "gemini";
  if (/chatgpt|gpt|openai/i.test(text)) return "chatgpt";
  if (/muse/i.test(text)) return "muse";
  return null;
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

// Canonical labels understood by lib/shop/categories.ts. Only ChatGPT, Claude,
// Gemini and Grok have their own rail entries; the rest share 其他.
const DISPLAY_CATEGORY: Record<string, string> = {
  "GPT（pro额度全体翻倍）": "ChatGPT",
  谷歌: "Gemini",
  "GROK-推特X-cursor": "Grok",
  Claude: "Claude",
  设计类AI: "其他",
  CapCut: "其他",
  "youtube-油管": "其他",
  suno: "其他",
  Autodesk: "其他",
  heygen: "其他",
};

function displayCategoryOf(item: ZyanaiItem): string {
  const name = item.category?.name?.trim() || "";
  return DISPLAY_CATEGORY[name] || normalizeDisplayCategory(name);
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

/**
 * Public slugs must never identify the supplier. `p-` is a neutral product
 * number; the supplier item id stays in shop_offers.
 */
function slugFor(
  id: number,
  brand: string,
  title: string,
  prefix = ZYANAI_SOURCE.slugPrefix,
): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${prefix}${id}${brand !== "other" ? `-${brand}` : ""}${ascii ? `-${ascii}` : ""}`.slice(0, 80);
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
  extras?: {
    imageUrls?: string[];
    helpArticleIds?: string[];
    /** Overrides the JSON-derived decision with the rendered page state. */
    preorder?: boolean;
    source?: TokyoSource;
  },
): ZyanaiProduct {
  const source = extras?.source ?? ZYANAI_SOURCE;
  const title = cleanTitle(item.name || "");
  const preorder = extras?.preorder ?? isPreorderStock(item);
  const rawDescription = scrubZyanaiCopy(extractReadableText(descriptionHtml), source);
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
  // 标题不一定带品牌词（"Plus 12个月卡密"），上游分类通常更准，先看分类再看标题。
  const brand = detectBrandFromCategory(item.category?.name) || detectBrand(title);
  const category = detectCategory(title);
  const imageUrls = (extras?.imageUrls ?? [])
    .slice(0, MAX_DESCRIPTION_IMAGES)
    .map((url) => ({ url, alt: imageAlt(url) }));
  return {
    externalId: `${source.kind}:${item.id}`,
    title,
    costMicros: Math.max(0, Math.round(Number(item.price || "0") * 1_000_000)),
    // A preorder is still purchasable: the supplier accepts the order and
    // ships in reservation order. Marking it low_stock keeps our order flow
    // (which only checks isPurchasable) working, while the preorder flag
    // replaces every "现货 / N 分钟发货" label on the storefront.
    availability: preorder ? "low_stock" : availabilityOf(item.stock),
    preorder,
    url: `${source.base}/item/${item.id}`,
    description,
    descriptionHtml: descriptionHtml.slice(0, 80_000),
    tags,
    brand,
    category,
    slug: slugFor(item.id, brand, title, source.slugPrefix),
    displayCategory: displayCategoryOf(item),
    coverUrl: item.cover ? absoluteHttpUrl(item.cover, source.base) : null,
    imageUrls,
    helpArticleIds: extras?.helpArticleIds ?? [],
    // 展示用：上游公开的已售与库存，每次同步刷新。
    supplierSold: Math.max(0, Math.trunc(Number(item.order_sold ?? 0)) || 0),
    supplierStock: normalizeSupplierStock(item.stock),
    ...detectWarranty(text),
  };
}

function listUrlOf(source: TokyoSource): string {
  return `${source.base}/user/api/index/commodity?limit=100&page=1`;
}

async function ensureSupplier(source: TokyoSource): Promise<string> {
  const existing = await query<{ id: string }>(
    "SELECT id FROM shop_suppliers WHERE kind = $1 ORDER BY created_at LIMIT 1",
    [source.kind],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await query<{ id: string }>(
    `INSERT INTO shop_suppliers (name, kind, feed_url, meta_url)
     VALUES ($1, $1, $2, $3) RETURNING id`,
    [source.kind, listUrlOf(source), source.base],
  );
  return inserted.rows[0].id;
}

async function loadCatalog(source: TokyoSource): Promise<ZyanaiItem[]> {
  const raw = await fetchText(listUrlOf(source));
  const parsed = JSON.parse(raw) as { code?: number; data?: ZyanaiItem[] };
  if (parsed.code !== 200 || !Array.isArray(parsed.data)) {
    throw new Error(`${source.kind} 商品列表格式不正确`);
  }
  return parsed.data.filter((item) => item.status === 1 && item.hide !== 1);
}

export async function syncTokyoProducts(
  source: TokyoSource,
  options?: TokyoSyncOptions,
): Promise<ZyanaiSyncResult> {
  const supplierId = await ensureSupplier(source);
  const catalog = await loadCatalog(source);
  const wanted = options?.ids && options.ids.length > 0 ? new Set(options.ids) : null;
  const filtered = wanted ? catalog.filter((item) => wanted.has(Number(item.id))) : catalog;
  const selected = options?.limit ? filtered.slice(0, options.limit) : filtered;
  const result: ZyanaiSyncResult = {
    supplierId,
    itemsSeen: filtered.length,
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
        const page = await fetchText(`${source.base}/item/${item.id}`);
        const parsed = parseItemPage(page, source.base);
        const merged: ZyanaiItem = { ...item, ...(parsed.item || {}), id: item.id };
        if (merged.status !== 1 || merged.hide === 1) {
          result.skipped.push({ id: item.id, reason: "下架" });
          continue;
        }
        const product = toProduct(merged, parsed.descriptionHtml, {
          imageUrls: parsed.imageUrls,
          helpArticleIds: parsed.helpArticleIds,
          // The rendered banner is the supplier's own UI truth; the JSON
          // fields cover pages whose theme no longer emits the class.
          preorder: parsed.reservationActive || isPreorderStock(merged),
          source,
        });
        if (!product.title || product.costMicros <= 0) {
          result.skipped.push({ id: item.id, reason: "标题或价格为空" });
          continue;
        }
        // 教程类条目不是可售商品（上游常挂占位价），不导入。
        if (/教程/.test(product.title)) {
          result.skipped.push({ id: item.id, reason: "教程类条目" });
          continue;
        }
        if (options?.dryRun) {
          result.imported += 1;
          continue;
        }
        await persistProduct(supplierId, product, source);
        result.imported += 1;
      } catch (error) {
        result.skipped.push({
          id: item.id,
          reason: error instanceof Error ? error.message.slice(0, 160) : "抓取失败",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    // 上游下架 → 我们也下架。
    //
    // 之前只有「同步到了就更新」，商品从上游列表消失时我们什么都不做，继续
    // 挂着卖——客户下单后我们才发现没货。
    //
    // 用「连续 2 次缺失」而不是一次：上游列表偶尔会抖动（分页、限流、临时
    // 报错），一次缺失就下架会把还在卖的商品误伤掉。第一次缺失只标记，
    // 第二次才真正下架。
    // 只有「同步了完整目录」时才做下架判断。用 --limit / --ids 只同步几款时，
    // 其他商品本来就不在 selected 里，按缺失处理会把它们全部误下架。
    const fullCatalog = !options?.limit && !(options?.ids && options.ids.length > 0);
    const seenKeys = catalog.map((item) => `${source.kind}:${item.id}`);
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
      // 只下架「货源已确认缺失」且当前在售的商品；运营手动暂停/归档的
      // 状态不动（那是他们的决定）。
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

type TokyoSyncOptions = {
  limit?: number;
  dryRun?: boolean;
  /** 只同步指定的上游商品 ID；不填则同步整个目录。 */
  ids?: number[];
};

/** zyanai 入口，保持既有调用方（脚本、内部路由、测试）不变。 */
export function syncZyanaiProducts(options?: TokyoSyncOptions): Promise<ZyanaiSyncResult> {
  return syncTokyoProducts(ZYANAI_SOURCE, options);
}

/** ai-buy.vip 入口。 */
export function syncAibuyProducts(options?: TokyoSyncOptions): Promise<ZyanaiSyncResult> {
  return syncTokyoProducts(AIBUY_SOURCE, options);
}

async function persistProduct(
  supplierId: string,
  product: ZyanaiProduct,
  source: TokyoSource,
): Promise<void> {
  const retail = autoRetailPrice(product.costMicros, await getShopTargetMarginBps());
  const productId = await withTransaction(async (client) => {
    const offer = await client.query<{ id: string; price_micros: string }>(
      `INSERT INTO shop_offers
         (supplier_id, external_key, supplier_product_slug, source_store, source_title,
          price_micros, availability, url, raw)
       VALUES ($1, $2, $3, $9, $4, $5, $6, $7, $8::jsonb)
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
        source.kind,
      ],
    );
    const offerId = offer.rows[0].id;
    await client.query(
      `INSERT INTO shop_offer_price_history (offer_id, price_micros, availability)
       VALUES ($1, $2, $3)`,
      [offerId, product.costMicros, product.availability],
    );

    // 同一个货源可能已经有一个「旧 slug」的商品（品牌识别规则改过之后，slug
    // 会变）。只按 slug 做 ON CONFLICT 会新建一行，旧的继续挂在线上，而新的
    // 才是每次同步刷新的那一行——于是前台看到的是一个永远没有库存/销量的旧商品。
    // 先按 offer 找已关联的商品，找到就复用它的 slug。
    const existing = await client.query<{ slug: string }>(
      `SELECT p.slug
         FROM shop_product_sources s
         JOIN shop_products p ON p.id = s.product_id
        WHERE s.offer_id = $1
          -- 归档行是运营或清理脚本停用的，不能把新同步导向它们。
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
       VALUES ($1,$2,$3,$3,$4,$5,$6,$2,$7,'manual',15,60,$8,$9,$10,$13::jsonb,$14,'active',$11,$15,
               TRUE,$12, CASE WHEN $11 = 'out_of_stock' THEN NULL ELSE now() END,
               $16, $17, now())
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, subtitle = EXCLUDED.subtitle,
             description = EXCLUDED.description,
             -- Supplier cost still drives the suggested price, but an
             -- operator-set retail price wins until they reset the lock.
             price_micros = CASE
               WHEN shop_products.price_locked THEN shop_products.price_micros
               ELSE EXCLUDED.price_micros
             END,
             warranty_type = EXCLUDED.warranty_type,
             warranty_days = EXCLUDED.warranty_days,
             warranty_note = EXCLUDED.warranty_note,
             help_article_ids = EXCLUDED.help_article_ids,
             display_category = EXCLUDED.display_category,
             availability = EXCLUDED.availability,
             -- 货源库存与已售：以货源为准，但要扣掉「已经卖给客户、我们还没去
             -- 上游下单」的那部分。否则客户买完、运营还没采购时，下一次同步会
             -- 把库存刷回原来的数字，页面看起来「货又回来了」，继续引导下单。
             --
             -- 判据是 procurement_status 而不是订单状态：运营一旦去上游买了
             -- （bought/delivered），上游的 order_sold/stock 就已经算进了这一单，
             -- 再减一次就是双重计数。
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
             -- Refresh the preorder marker every sync. Do not clobber an
             -- operator's pricing-review reason with NULL; only clear the
             -- marker itself when the supplier is back in stock.
             availability_reason = CASE
               WHEN EXCLUDED.availability_reason IS NOT NULL
                 THEN EXCLUDED.availability_reason
               WHEN shop_products.availability_reason = '${PREORDER_MARKER}'
                 THEN NULL
               ELSE shop_products.availability_reason
             END,
             -- Operators pause or archive a product on purpose. A scheduled
             -- supply sync may refresh copy and price, but it must never put
             -- a product they took down back on sale.
             published_at = COALESCE(shop_products.published_at, EXCLUDED.published_at),
             updated_at = now()
       RETURNING id`,
      [
        slug,
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
        product.preorder ? PREORDER_MARKER : null,
        product.supplierSold,
        product.supplierStock,
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
      base: source.base,
      identities: [{ store: source.kind, url: source.base }],
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
      `[shop/${source.kind}] 商品 ${product.externalId} 富文本排版失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
