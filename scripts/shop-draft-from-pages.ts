import fs from "node:fs";
import {
  createImportJob,
  runImportJob,
  type ImportJobResult,
} from "@/lib/shop/import";
import { query } from "@/lib/db";

/**
 * Creates draft products from already-captured supplier page text.
 *
 * Some stores (wzyp.cn and friends) render product pages with JavaScript, so
 * the app's plain fetch sees an empty shell. Capture the text with a browser
 * first (see /tmp/shop-sms-pages.json shape), then run:
 *
 *   npx tsx scripts/shop-draft-from-pages.ts /tmp/shop-sms-pages.json --dry-run
 *   npx tsx scripts/shop-draft-from-pages.ts /tmp/shop-sms-pages.json
 *
 * Drafts only. Publishing still needs the admin product editor and the
 * compliance checkbox. Duplicate titles keep the cheapest source unless
 * --all is passed.
 */

type PageEntry = {
  title: string;
  store: string;
  url: string;
  price?: number;
  availability?: string;
  text: string;
};

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--")) || "/tmp/shop-sms-pages.json";
const dryRun = args.includes("--dry-run");
const keepDuplicates = args.includes("--all");

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[，。！？、；：“”‘’（）()【】\[\]—…·+\-_/]/g, "");
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as PageEntry[];
  const entries = raw.filter((entry) => entry.url && entry.text && entry.text.length >= 40);

  const admin = await query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1",
  );
  const adminId = admin.rows[0]?.id ?? null;

  const chosen = new Map<string, PageEntry>();
  for (const entry of entries) {
    const key = normalizeTitle(entry.title);
    if (keepDuplicates) {
      chosen.set(`${key}-${entry.url}`, entry);
      continue;
    }
    const current = chosen.get(key);
    if (!current || (entry.price ?? Infinity) < (current.price ?? Infinity)) {
      chosen.set(key, entry);
    }
  }

  const results: {
    title: string;
    store: string;
    offerId?: string;
    status: string;
    productId?: string | null;
    error?: string | null;
  }[] = [];

  for (const entry of chosen.values()) {
    const offer = await query<{
      id: string;
      product_id: string | null;
    }>(
      `SELECT o.id, p.id AS product_id
         FROM shop_offers o
         LEFT JOIN LATERAL (
           SELECT sp.id
             FROM shop_product_sources s
             JOIN shop_products sp ON sp.id = s.product_id
            WHERE s.offer_id = o.id AND s.active = TRUE
            LIMIT 1
         ) p ON TRUE
        WHERE o.url = $1
           OR (o.source_store = $2 AND o.source_title = $3)
        ORDER BY (o.url = $1) DESC
        LIMIT 1`,
      [entry.url, entry.store, entry.title],
    );
    const row = offer.rows[0];
    if (!row) {
      results.push({ title: entry.title, store: entry.store, status: "offer_not_found" });
      continue;
    }
    if (row.product_id) {
      results.push({
        title: entry.title,
        store: entry.store,
        offerId: row.id,
        status: "already_listed",
        productId: row.product_id,
      });
      continue;
    }
    if (dryRun) {
      results.push({ title: entry.title, store: entry.store, offerId: row.id, status: "would_create" });
      continue;
    }

    let result: ImportJobResult;
    try {
      const job = await createImportJob(row.id, adminId);
      result = await runImportJob(job.id, { sourceText: entry.text });
    } catch (error) {
      results.push({
        title: entry.title,
        store: entry.store,
        offerId: row.id,
        status: "failed",
        error: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }
    results.push({
      title: entry.title,
      store: entry.store,
      offerId: row.id,
      status: result.status,
      productId: result.productId,
      error: result.error,
    });
  }

  const summary = results.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ file, dryRun, total: results.length, summary, results }, null, 2));
}

await main();
process.exit(0);
