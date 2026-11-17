/**
 * 构建评测样本集（fixtures）。
 *
 * 输出写到仓库外的 .local-data/eval/fixtures.json —— 样本里是货源正文，
 * 绝不能进 public 仓库。构建完成后这个文件就是冻结快照，评测不再联网。
 *
 * 抽样规则：
 *   - 按品类分层，每层尽量多取，总数默认 30
 *   - 排除已经映射到商品的 offer（模型/规则可能已生成过文案，会污染评测）
 *   - 正文抓取失败或过短的跳过，继续补足
 *   - 全文先 sanitizeSupplierCopy 脱敏，再落盘
 *
 * 用法：
 *   npx tsx scripts/eval/build-fixtures.ts            # 默认 30 条
 *   npx tsx scripts/eval/build-fixtures.ts --limit 50
 *   npx tsx scripts/eval/build-fixtures.ts --from-db  # 只从已存正文构建（不联网）
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnv } from "../env.mjs";
import { query } from "@/lib/db";
import { classifyOffer, type OfferCategory } from "@/lib/shop/offer-classify";
import { categoryFor, extractNoticeCopy, fetchSupplierText } from "@/lib/shop/import";
import { sanitizeSupplierCopy } from "@/lib/shop/sanitize";
import type { EvalFixture } from "./metrics";

loadEnv();

const DEFAULT_LIMIT = 30;
const MIN_TEXT_CHARS = 120;
const FETCH_DELAY_MS = 1_500;
const OUTPUT = ".local-data/eval/fixtures.json";

type OfferRow = {
  id: string;
  source_title: string;
  source_store: string;
  price_micros: string;
  url: string | null;
  mapped: boolean;
  text_len: string | null;
};

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixtureId(title: string, text: string): string {
  return createHash("sha256").update(`${title}\n${text.slice(0, 200)}`).digest("hex").slice(0, 16);
}

async function main() {
  const limit = Number(argValue("--limit") || DEFAULT_LIMIT);
  const offline = hasFlag("--from-db");

  // 只取未映射的货源：已上架商品可能已经用模型生成过文案，放进评测集会泄漏。
  const offers = await query<OfferRow>(
    `SELECT o.id, o.source_title, o.source_store, o.price_micros, o.url,
            (p.id IS NOT NULL) AS mapped,
            COALESCE(length(o.raw->>'text'), 0)::text AS text_len
       FROM shop_offers o
       LEFT JOIN LATERAL (
         SELECT sp.id FROM shop_product_sources s
           JOIN shop_products sp ON sp.id = s.product_id
          WHERE s.offer_id = o.id AND s.active = TRUE LIMIT 1
       ) p ON TRUE
      WHERE p.id IS NULL
      ORDER BY random()
      LIMIT $1`,
    [limit * 4],
  );

  // 按品类分层：每层轮流取一条，保证覆盖面。不少货源页是 JS 渲染、抓不到
  // 正文（实测约 3/4 会被跳过），所以候选池按目标的 4 倍准备，成功率低于
  // 预期时仍能凑够样本。
  const byCategory = new Map<OfferCategory, OfferRow[]>();
  for (const offer of offers.rows) {
    const { category } = classifyOffer(offer.source_title);
    const list = byCategory.get(category) || [];
    list.push(offer);
    byCategory.set(category, list);
  }
  const buckets = [...byCategory.values()];
  const picked: OfferRow[] = [];
  const candidateTarget = Math.min(offers.rows.length, limit * 4);
  let cursor = 0;
  while (picked.length < candidateTarget && buckets.some((bucket) => bucket.length > 0)) {
    const bucket = buckets[cursor % buckets.length];
    const next = bucket.shift();
    if (next) picked.push(next);
    cursor += 1;
  }

  const fixtures: EvalFixture[] = [];
  let skipped = 0;

  for (const [index, offer] of picked.entries()) {
    if (fixtures.length >= limit) break;
    let text = "";
    const stored = offer.text_len ? Number(offer.text_len) : 0;
    if (offline || stored === 0) {
      if (!offer.url) {
        skipped += 1;
        continue;
      }
      try {
        text = await fetchSupplierText(offer.url);
      } catch (error) {
        skipped += 1;
        console.warn(
          `[${index + 1}/${picked.length}] 抓取失败：${error instanceof Error ? error.message : "unknown"}`,
        );
        continue;
      }
      if (!offline) await sleep(FETCH_DELAY_MS);
    }

    if (text.length < MIN_TEXT_CHARS) {
      skipped += 1;
      continue;
    }

    // 双重脱敏：正文先洗一遍再进样本。
    const identity = { store: offer.source_store, url: offer.url };
    const clean = sanitizeSupplierCopy(text, identity);
    const { category, displayCategory } = categoryFor(offer.source_title);
    const lifted = extractNoticeCopy(clean, category);

    fixtures.push({
      id: fixtureId(offer.source_title, clean),
      title: sanitizeSupplierCopy(offer.source_title, identity),
      priceMicros: Number(offer.price_micros || 0),
      category,
      displayCategory,
      sourceText: clean,
      expect: {
        warrantyType: lifted.warranty_type,
        hasNotice: Boolean(lifted.notice),
        // 规则版固定给 3 条；模型方案低于 3 条视为信息不完整。
        minIncludes: 3,
      },
    });
    console.log(`[${index + 1}/${picked.length}] ✓ ${fixtures.length} 条 · ${category}`);
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        count: fixtures.length,
        skipped,
        fixtures,
      },
      null,
      2,
    ),
  );

  const cats = new Map<string, number>();
  for (const fixture of fixtures) {
    cats.set(fixture.category, (cats.get(fixture.category) || 0) + 1);
  }
  console.log(`\n写入 ${OUTPUT}`);
  console.log(`样本 ${fixtures.length} 条，跳过 ${skipped} 条`);
  console.log(
    `品类分布：${[...cats.entries()].map(([key, value]) => `${key}=${value}`).join(" ")}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
