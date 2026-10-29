import { z } from "zod";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { suggestRetailPrice } from "@/lib/shop/catalog";
import { classifyOffer } from "@/lib/shop/offer-classify";

/**
 * Turns a supplier offer into a draft shop product.
 *
 * Nothing here publishes: every product is inserted as `draft` and only the
 * existing admin editor can flip it to `active` after a human acknowledgement.
 * With `SHOP_IMPORT_AI_*` configured the copy comes from an OpenAI-compatible
 * model; otherwise a rule-based extractor fills the same shape. The supplier's
 * notice text is always verified against the scraped page so the model cannot
 * silently rewrite refund or warranty rules.
 */

export type ImportJobResult = {
  jobId: string;
  status: "queued" | "running" | "draft_ready" | "failed" | "skipped";
  productId?: string | null;
  error?: string | null;
};

const AI_SCHEMA = z.object({
  name: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(2000),
  includes: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  usage: z.array(z.string().trim().min(1).max(400)).min(1).max(10),
  notice: z.string().trim().max(8000),
  refund: z.string().trim().max(2000),
  warranty_type: z.enum(["first_login", "days", "none"]).optional(),
  warranty_days: z.number().int().min(0).max(365).optional(),
  warranty_note: z.string().trim().max(200).optional(),
});

type DraftCopy = z.infer<typeof AI_SCHEMA> & {
  engine: "heuristic" | "ai";
  note: string;
};

type OfferRow = {
  id: string;
  external_key: string;
  source_title: string;
  source_store: string;
  price_micros: string;
  availability: string;
  url: string;
  product_id: string | null;
  product_status: string | null;
};

const MAX_SOURCE_CHARS = 12_000;

function isSafeSupplierUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split(".").map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/** Very small readability pass: drop non-content tags, keep line breaks. */
export function extractReadableText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 1)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

async function fetchSupplierText(url: string): Promise<string> {
  if (!isSafeSupplierUrl(url)) throw new Error("货源链接不是可抓取的公开地址");
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`货源页面返回 ${response.status}`);
  const html = (await response.text()).slice(0, 500_000);
  const text = extractReadableText(html);
  if (text.length < 40) throw new Error("货源页面没有可读文本，可能需登录或由 JS 渲染");
  return text;
}

function normalizeForCompare(input: string): string {
  return input.replace(/\s+/g, "").replace(/[，。！？、；：“”‘’（）()【】\[\]—…·]/g, "");
}

function noticeIsVerbatim(notice: string, sourceText: string): boolean {
  const source = normalizeForCompare(sourceText);
  const lines = notice
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 4);
  if (lines.length === 0) return false;
  return lines.every((line) => source.includes(normalizeForCompare(line)));
}

function inferBrand(title: string): string {
  if (/muse/i.test(title)) return "muse";
  if (/claude|anthropic/i.test(title)) return "claude";
  if (/gemini|谷歌\s*ai/i.test(title)) return "gemini";
  if (/grok/i.test(title)) return "grok";
  if (/chatgpt|openai|codex|\bgpt\b/i.test(title)) return "chatgpt";
  return "other";
}

function categoryFor(title: string): { category: string; productType: string } {
  const { category } = classifyOffer(title);
  switch (category) {
    case "sms":
    case "code":
      return { category: "giftcard", productType: "giftcard" };
    case "account":
      return { category: "account", productType: "account" };
    case "subscription":
      return { category: "subscription", productType: "subscription" };
    case "topup":
    case "api":
      return { category: "topup", productType: "topup" };
    default:
      return { category: "other", productType: "account" };
  }
}

function firstMeaningfulLines(text: string, count: number): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 6 && !/^(首页|登录|注册|购物车|客服|关于我们)$/.test(line))
    .slice(0, count);
}

function heuristicCopy(offer: OfferRow, sourceText: string | null): DraftCopy {
  const title = offer.source_title.trim().slice(0, 120);
  const lines = sourceText ? firstMeaningfulLines(sourceText, 4) : [];
  const hasText = Boolean(sourceText);
  return {
    engine: "heuristic",
    note: hasText ? "" : "货源页面抓取失败，注意事项需要人工补全",
    name: title,
    subtitle: `${offer.source_store || "货源"} · 人工审核后发货`,
    description: hasText
      ? lines.join("\n").slice(0, 1200) || title
      : `${title}。货源页面暂时无法读取，商品说明以人工审核为准。`,
    includes: [`商品：${title}`, `货源店铺：${offer.source_store || "未标注"}`, "人工发货"],
    usage: ["下单前确认商品说明与注意事项。", "完成支付后按订单页指引领取。", "遇到问题先在订单页联系客服。"],
    notice: sourceText ? `以下为货源原文（自动抓取，未改写）：\n${sourceText.slice(0, 5000)}` : "",
    refund: hasText
      ? "售后规则以货源原文为准，虚拟商品非质量问题不支持无理由退换货。"
      : "",
    warranty_type: categoryFor(offer.source_title).category === "giftcard" ? "none" : "first_login",
    warranty_days: 0,
    warranty_note: "",
  };
}

function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

async function callChatModel(prompt: string): Promise<string> {
  const base = config.shopImportAiBaseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const payload = {
    model: config.shopImportAiModel,
    messages: [
      {
        role: "system",
        content:
          "你是中文数字商品店的文案助理。只输出 JSON，不要输出 Markdown。" +
          "所有关于退款、质保、注意事项的内容必须逐字摘抄货源原文，不能改写、不能补充原文没有的承诺。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 2200,
  };
  const send = (body: unknown) =>
    fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.shopImportAiApiKey}`,
      },
      body: JSON.stringify(body),
    });

  let response = await send({ ...payload, response_format: { type: "json_object" } });
  if (response.status === 400) {
    // Some OpenAI-compatible providers reject response_format.
    response = await send(payload);
  }
  if (!response.ok) throw new Error(`AI 接口返回 ${response.status}`);
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 接口没有返回内容");
  return content;
}

async function aiCopy(offer: OfferRow, sourceText: string): Promise<DraftCopy> {
  const prompt = [
    `货源标题：${offer.source_title}`,
    `货源店铺：${offer.source_store || "未标注"}`,
    `货源地址：${offer.url}`,
    `成本价（人民币元）：${(Number(offer.price_micros) / 1_000_000).toFixed(2)}`,
    "",
    "请根据下面的货源页面原文，生成上架草稿。要求：",
    "1. name：面向买家的中文商品名，不超过 40 字。",
    "2. subtitle：一句话卖点，不超过 40 字，不得夸大。",
    "3. description：商品介绍，忠于原文，不得编造功能。",
    "4. includes：买家会收到的东西，3–6 条。",
    "5. usage：买家操作步骤，3–8 条，按原文整理。",
    "6. notice：购买注意事项，必须逐字摘抄原文中对应的句子，不能改写；没有就留空字符串。",
    "7. refund：退款与质保原文，必须逐字摘抄；原文没有明确写就留空字符串。",
    "8. warranty_type：first_login / days / none，按原文判断。",
    "9. warranty_days：质保天数，没有就 0。",
    "10. warranty_note：质保口径原文，没有就空字符串。",
    "",
    "输出 JSON 字段：name, subtitle, description, includes, usage, notice, refund, warranty_type, warranty_days, warranty_note。",
    "",
    "货源页面原文：",
    sourceText,
  ].join("\n");

  const raw = await callChatModel(prompt);
  const parsed = AI_SCHEMA.parse(JSON.parse(stripCodeFence(raw)));
  let notice = parsed.notice;
  let note = "";
  if (notice && !noticeIsVerbatim(notice, sourceText)) {
    notice = `以下为货源原文（未经改写）：\n${sourceText.slice(0, 5000)}`;
    note = "AI 生成的注意事项未通过原文校验，已回退为货源原文";
  }
  return { ...parsed, notice, engine: "ai", note };
}

function slugFor(offer: OfferRow): string {
  const key = offer.external_key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `auto-${key || offer.id.slice(0, 8)}-${offer.id.slice(0, 6)}`;
}

function priceFor(offer: OfferRow): number {
  const cost = Number(offer.price_micros || 0);
  if (cost <= 0) return 0;
  return suggestRetailPrice(cost, config.shopImportTargetMarginBps);
}

export async function createImportJob(
  offerId: string,
  adminId: string,
): Promise<{ id: string; status: string }> {
  const inserted = await query<{ id: string; status: string }>(
    `INSERT INTO shop_import_jobs (offer_id, created_by)
     VALUES ($1, $2)
     ON CONFLICT (offer_id) WHERE status IN ('queued', 'running') DO NOTHING
     RETURNING id, status`,
    [offerId, adminId],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await query<{ id: string; status: string }>(
    `SELECT id, status FROM shop_import_jobs
      WHERE offer_id = $1 AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [offerId],
  );
  if (existing.rows[0]) return existing.rows[0];
  throw new Error("无法创建上架任务");
}

async function failJob(jobId: string, message: string): Promise<ImportJobResult> {
  await query(
    `UPDATE shop_import_jobs
        SET status = 'failed', error = $2, finished_at = now(), updated_at = now()
      WHERE id = $1`,
    [jobId, message.slice(0, 500)],
  );
  return { jobId, status: "failed", error: message };
}

async function linkOffer(productId: string, offer: OfferRow): Promise<void> {
  await query(
    `INSERT INTO shop_product_sources
       (product_id, offer_id, role, active, supplier_cost_micros,
        supplier_availability, last_synced_at)
     VALUES ($1, $2, 'primary', TRUE, $3, $4, now())
     ON CONFLICT (product_id, offer_id) DO UPDATE SET
       active = TRUE,
       supplier_cost_micros = EXCLUDED.supplier_cost_micros,
       supplier_availability = EXCLUDED.supplier_availability,
       last_synced_at = now()`,
    [productId, offer.id, offer.price_micros, offer.availability],
  );
}

async function skipJob(
  jobId: string,
  productId: string | null,
  message: string,
): Promise<ImportJobResult> {
  await query(
    `UPDATE shop_import_jobs
        SET status = 'skipped', product_id = $2, note = $3,
            finished_at = now(), updated_at = now()
      WHERE id = $1`,
    [jobId, productId, message.slice(0, 500)],
  );
  return { jobId, status: "skipped", productId };
}

export async function runImportJob(jobId: string): Promise<ImportJobResult> {
  const claimed = await query<{ id: string; offer_id: string }>(
    `UPDATE shop_import_jobs
        SET status = 'running', started_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING id, offer_id`,
    [jobId],
  );
  const job = claimed.rows[0];
  if (!job) {
    const current = await query<{ status: ImportJobResult["status"]; product_id: string | null; error: string | null }>(
      "SELECT status, product_id, error FROM shop_import_jobs WHERE id = $1",
      [jobId],
    );
    const row = current.rows[0];
    return {
      jobId,
      status: row?.status ?? "skipped",
      productId: row?.product_id ?? null,
      error: row?.error ?? null,
    };
  }

  try {
    const offerResult = await query<OfferRow>(
      `SELECT o.id, o.external_key, o.source_title, o.source_store, o.price_micros,
              o.availability, o.url,
              p.id AS product_id, p.status AS product_status
         FROM shop_offers o
         LEFT JOIN shop_product_sources s ON s.offer_id = o.id AND s.active = TRUE
         LEFT JOIN shop_products p ON p.id = s.product_id
        WHERE o.id = $1
        LIMIT 1`,
      [job.offer_id],
    );
    const offer = offerResult.rows[0];
    if (!offer) return await failJob(jobId, "货源不存在或已被删除");

    if (offer.product_id) {
      return await skipJob(jobId, offer.product_id, "该货源已经映射到商品，请直接审核商品");
    }

    const slug = slugFor(offer);
    const existing = await query<{ id: string; status: string }>(
      "SELECT id, status FROM shop_products WHERE slug = $1 LIMIT 1",
      [slug],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      await linkOffer(row.id, offer);
      if (row.status === "draft") {
        return await skipJob(jobId, row.id, "该货源已有草稿商品，请直接审核");
      }
      return await skipJob(jobId, row.id, `该货源已有${row.status}状态的商品`);
    }

    let sourceText: string | null = null;
    let fetchError: string | null = null;
    try {
      sourceText = await fetchSupplierText(offer.url);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : "货源页面抓取失败";
    }

    let copy: DraftCopy;
    if (sourceText && config.shopImportAiBaseUrl && config.shopImportAiApiKey && config.shopImportAiModel) {
      try {
        copy = await aiCopy(offer, sourceText);
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI 文案生成失败";
        copy = heuristicCopy(offer, sourceText);
        copy.note = `${message}，已回退为规则提取`;
      }
    } else {
      copy = heuristicCopy(offer, sourceText);
      if (!config.shopImportAiBaseUrl) {
        copy.note = [copy.note, "未配置 AI，使用规则提取"].filter(Boolean).join("；");
      }
    }
    if (fetchError) copy.note = [copy.note, fetchError].filter(Boolean).join("；");

    const brand = inferBrand(offer.source_title);
    const { category, productType } = categoryFor(offer.source_title);
    const price = priceFor(offer);
    const availability =
      offer.availability === "in_stock" || offer.availability === "low_stock"
        ? offer.availability
        : "out_of_stock";
    const copyReady =
      Boolean(copy.name && copy.subtitle && copy.description) &&
      copy.includes.length > 0 &&
      copy.usage.length > 0 &&
      Boolean(copy.notice) &&
      Boolean(copy.refund) &&
      price > 0;

    const sortResult = await query<{ next: string }>(
      "SELECT (COALESCE(MAX(sort_order), 0) + 10)::text AS next FROM shop_products",
    );
    const sortOrder = Number(sortResult.rows[0]?.next || 10);

    const inserted = await query<{ id: string }>(
      `INSERT INTO shop_products
         (slug, brand, category, product_type, name, subtitle, description,
          cover_variant, price_micros, delivery_method, eta_min_minutes,
          eta_max_minutes, warranty_type, warranty_days, warranty_note,
          includes, usage_notes, customer_notice, refund_policy,
          status, availability, copy_ready, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',15,120,$10,$11,$12,
               $13::jsonb,$14::jsonb,$15,$16,'draft',$17,$18,$19)
       RETURNING id`,
      [
        slug,
        brand,
        category,
        productType,
        copy.name,
        copy.subtitle,
        copy.description,
        brand === "other" ? "neutral" : brand,
        price,
        copy.warranty_type || "first_login",
        copy.warranty_days || 0,
        copy.warranty_note || "",
        JSON.stringify(copy.includes),
        JSON.stringify(copy.usage),
        copy.notice,
        copy.refund,
        availability,
        copyReady,
        sortOrder,
      ],
    );
    const productId = inserted.rows[0].id;

    await linkOffer(productId, offer);

    await query(
      `UPDATE shop_import_jobs
          SET status = 'draft_ready', product_id = $2, engine = $3, note = $4,
              error = NULL, finished_at = now(), updated_at = now()
        WHERE id = $1`,
      [jobId, productId, copy.engine, copy.note || null],
    );

    return { jobId, status: "draft_ready", productId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成草稿失败";
    return await failJob(jobId, message);
  }
}

export async function runQueuedJobs(limit = 3): Promise<ImportJobResult[]> {
  const capped = Math.min(Math.max(limit, 1), 5);
  const queued = await query<{ id: string }>(
    `SELECT id FROM shop_import_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT $1`,
    [capped],
  );
  const results: ImportJobResult[] = [];
  for (const row of queued.rows) {
    results.push(await runImportJob(row.id));
  }
  return results;
}
