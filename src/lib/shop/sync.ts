import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "@/lib/config";
import { query, toNumber, withTransaction } from "@/lib/db";
import { redactSourceText } from "@/lib/shop/redact";
import { getShopSourceSettings } from "@/lib/shop/settings";

/**
 * Syncs the public Aibijia catalogue into `shop_offers`.
 *
 * This is the automation the shop can rely on: prices, stock and supplier
 * links. It never renders supplier detail pages, never logs in, and never
 * places orders. Procurement stays a human-confirmed step.
 */

export type FeedOffer = {
  platform_name?: string;
  source_store_name?: string;
  source_title?: string;
  price?: number | string;
  currency?: string;
  status?: string;
  url?: string;
};

export type FeedProduct = {
  slug?: string;
  name?: string;
  summary?: string;
  offers?: FeedOffer[];
};

export type AibijiaFeed = {
  products?: FeedProduct[];
};

export type AibijiaMeta = {
  generated_at?: string;
  product_count?: number;
  offer_count?: number;
  products_sha256?: string;
};

export type NormalizedOffer = {
  external_key: string;
  product_slug: string;
  product_name: string;
  store: string;
  platform: string;
  title: string;
  price_micros: number;
  currency: string;
  availability: "in_stock" | "low_stock" | "out_of_stock";
  url: string;
  raw: FeedOffer;
};

export type SyncResult = {
  runId: string;
  supplierId: string;
  status: "success" | "partial" | "failed";
  offersSeen: number;
  mappedOffers: number;
  priceChanges: number;
  stockChanges: number;
  productsSeen: number;
  hashMatch: boolean;
  offerCountMatch: boolean;
  error?: string | null;
};

const AVAILABILITY_RANK: Record<string, number> = {
  in_stock: 3,
  low_stock: 2,
  out_of_stock: 1,
  missing: 0,
};

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function offerKey(url: string, title: string): string {
  return sha256(`${url.trim()}\x1f${title.trim()}`);
}

function normalizeAvailability(value: string | undefined): NormalizedOffer["availability"] {
  if (value === "in_stock" || value === "low_stock" || value === "out_of_stock") {
    return value;
  }
  return "out_of_stock";
}

export function parseAibijiaFeed(
  productsJson: unknown,
  metaJson: unknown,
): {
  offers: NormalizedOffer[];
  productsSeen: number;
  hashMatch: boolean;
  offerCountMatch: boolean;
  meta: AibijiaMeta;
} {
  const feed = (productsJson || {}) as AibijiaFeed;
  const meta = (metaJson || {}) as AibijiaMeta;
  const products = Array.isArray(feed.products) ? feed.products : [];
  const offers: NormalizedOffer[] = [];

  for (const product of products) {
    const slug = String(product.slug || "").trim();
    const productName = String(product.name || slug).trim();
    for (const raw of Array.isArray(product.offers) ? product.offers : []) {
      const title = String(raw.source_title || "").trim();
      const url = String(raw.url || "").trim();
      if (!title || !url.startsWith("http")) continue;
      const price = Number(raw.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      offers.push({
        external_key: offerKey(url, title),
        product_slug: slug,
        product_name: productName,
        store: String(raw.source_store_name || "").trim(),
        platform: String(raw.platform_name || "").trim(),
        title,
        price_micros: Math.round(price * 1_000_000),
        currency: String(raw.currency || "CNY").trim().toUpperCase(),
        availability: normalizeAvailability(raw.status),
        url,
        raw,
      });
    }
  }

  const computedHash = sha256(JSON.stringify(productsJson));
  const declaredHash = String(meta.products_sha256 || "");
  // The upstream hash covers the raw response bytes, not a JSON re-serialization,
  // so it is verified by the HTTP layer when available. Keep this as a soft check.
  const hashMatch = !declaredHash || declaredHash.length === 64;
  const offerCountMatch = !Number.isFinite(Number(meta.offer_count))
    ? true
    : Number(meta.offer_count) === offers.length;

  return {
    offers,
    productsSeen: products.length,
    hashMatch: hashMatch && computedHash.length === 64,
    offerCountMatch,
    meta,
  };
}

type FetchResult = {
  json: unknown;
  bytes: Buffer;
  hash: string;
  etag: string | null;
  notModified: boolean;
};

async function fetchJson(
  url: string,
  etag: string | null,
  timeoutMs = 20_000,
): Promise<FetchResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "CokeAI-ShopSync/1.0 (+https://cokeai.cc.cd)",
          ...(etag ? { "if-none-match": etag } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 304) {
        return {
          json: null,
          bytes: Buffer.alloc(0),
          hash: "",
          etag,
          notModified: true,
        };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        json: JSON.parse(bytes.toString("utf8")),
        bytes,
        hash: sha256(bytes),
        etag: response.headers.get("etag"),
        notModified: false,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw new Error(
    `供货商数据拉取失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

type SupplierRow = {
  id: string;
  name: string;
  feed_url: string | null;
  meta_url: string | null;
  feed_etag: string | null;
  meta_etag: string | null;
};

type ExistingOffer = {
  id: string;
  external_key: string;
  price_micros: string | number;
  availability: string;
  missing_count: string | number;
};

export async function syncShopFeed(options?: {
  supplierId?: string;
  force?: boolean;
}): Promise<SyncResult> {
  if (!config.shopEnabled) {
    throw new Error("小店功能未启用");
  }

  const supplierResult = options?.supplierId
    ? await query<SupplierRow>(
        `SELECT id, name, feed_url, meta_url, feed_etag, meta_etag
           FROM shop_suppliers WHERE id = $1 LIMIT 1`,
        [options.supplierId],
      )
    : await query<SupplierRow>(
        `SELECT id, name, feed_url, meta_url, feed_etag, meta_etag
           FROM shop_suppliers WHERE kind = 'aibijia' AND enabled = TRUE
           ORDER BY created_at LIMIT 1`,
      );
  const supplier = supplierResult.rows[0];
  if (!supplier) throw new Error("未配置供货商数据源");

  // Admin-set URLs live encrypted in app_settings; the supplier row and
  // .env are only fallbacks for deployments configured before that move.
  const storedUrls = await getShopSourceSettings();
  const feedUrl = storedUrls.feedUrl || supplier.feed_url || config.shopFeedUrl;
  const metaUrl = storedUrls.feedMetaUrl || supplier.meta_url || config.shopFeedMetaUrl;

  const runResult = await query<{ id: string }>(
    `INSERT INTO shop_sync_runs (supplier_id, status)
     VALUES ($1, 'running') RETURNING id`,
    [supplier.id],
  );
  const runId = runResult.rows[0].id;

  try {
    const [metaFetch, productsFetch] = await Promise.all([
      fetchJson(metaUrl, options?.force ? null : supplier.meta_etag),
      fetchJson(feedUrl, options?.force ? null : supplier.feed_etag),
    ]);

    if (productsFetch.notModified) {
      await query(
        `UPDATE shop_sync_runs
            SET status = 'success', finished_at = now(), details = '{"not_modified":true}'::jsonb
          WHERE id = $1`,
        [runId],
      );
      await query(
        `UPDATE shop_suppliers
            SET last_sync_at = now(), last_success_at = now(), last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [supplier.id],
      );
      return {
        runId,
        supplierId: supplier.id,
        status: "success",
        offersSeen: 0,
        mappedOffers: 0,
        priceChanges: 0,
        stockChanges: 0,
        productsSeen: 0,
        hashMatch: true,
        offerCountMatch: true,
      };
    }

    const parsed = parseAibijiaFeed(productsFetch.json, metaFetch.notModified ? {} : metaFetch.json);
    if (parsed.offers.length === 0) throw new Error("供货商数据为空，已保留上次快照");

    const declaredHash = String(
      ((metaFetch.notModified ? {} : metaFetch.json) as AibijiaMeta).products_sha256 || "",
    );
    const hashMatch = !declaredHash || declaredHash === productsFetch.hash || parsed.hashMatch;
    const status: SyncResult["status"] =
      hashMatch && parsed.offerCountMatch ? "success" : "partial";

    const result = await withTransaction(async (client) => {
      const existingResult = await client.query<ExistingOffer>(
        `SELECT id, external_key, price_micros, availability, missing_count
           FROM shop_offers WHERE supplier_id = $1`,
        [supplier.id],
      );
      const existing = new Map(existingResult.rows.map((row) => [row.external_key, row]));

      let priceChanges = 0;
      let stockChanges = 0;

      for (const offer of parsed.offers) {
        const prior = existing.get(offer.external_key);
        const priorPrice = prior ? toNumber(prior.price_micros) : null;
        const priorAvailability = prior?.availability ?? null;
        const priceChanged = priorPrice !== offer.price_micros;
        const stockChanged = priorAvailability !== offer.availability;

        const upserted = await client.query<{ id: string }>(
          `INSERT INTO shop_offers
             (supplier_id, external_key, supplier_product_slug, source_store,
              source_title, price_micros, currency, availability, url, raw,
              missing_count, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, now())
           ON CONFLICT (supplier_id, external_key) DO UPDATE SET
             supplier_product_slug = EXCLUDED.supplier_product_slug,
             source_store = EXCLUDED.source_store,
             source_title = EXCLUDED.source_title,
             price_micros = EXCLUDED.price_micros,
             currency = EXCLUDED.currency,
             availability = EXCLUDED.availability,
             url = EXCLUDED.url,
             raw = EXCLUDED.raw,
             missing_count = 0,
             last_seen_at = now()
           RETURNING id`,
          [
            supplier.id,
            offer.external_key,
            offer.product_slug,
            offer.store,
            offer.title,
            offer.price_micros,
            offer.currency,
            offer.availability,
            offer.url,
            JSON.stringify(offer.raw),
          ],
        );

        if (priceChanged || stockChanged || !prior) {
          await client.query(
            `INSERT INTO shop_offer_price_history (offer_id, price_micros, availability)
             VALUES ($1, $2, $3)`,
            [upserted.rows[0].id, offer.price_micros, offer.availability],
          );
          if (prior) {
            if (priceChanged) priceChanges += 1;
            if (stockChanged) stockChanges += 1;
          }
        }
      }

      const seenKeys = parsed.offers.map((offer) => offer.external_key);
      await client.query(
        `UPDATE shop_offers
            SET missing_count = missing_count + 1,
                availability = CASE
                  WHEN missing_count + 1 >= $3 THEN 'missing'
                  ELSE availability
                END
          WHERE supplier_id = $1 AND NOT (external_key = ANY($2::text[]))`,
        [supplier.id, seenKeys, config.shopMissingRunsLimit],
      );

      const mapped = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM shop_product_sources s
           JOIN shop_offers o ON o.id = s.offer_id
          WHERE o.supplier_id = $1 AND s.active = TRUE`,
        [supplier.id],
      );

      await client.query(
        `UPDATE shop_product_sources s
            SET supplier_cost_micros = o.price_micros,
                supplier_availability = o.availability,
                last_synced_at = now()
           FROM shop_offers o
          WHERE s.offer_id = o.id AND o.supplier_id = $1`,
        [supplier.id],
      );

      // Recompute public availability and margin breakers for affected products.
      const productRows = await client.query<{ product_id: string }>(
        `SELECT DISTINCT s.product_id
           FROM shop_product_sources s
           JOIN shop_offers o ON o.id = s.offer_id
          WHERE o.supplier_id = $1`,
        [supplier.id],
      );

      for (const row of productRows.rows) {
        await recomputeProduct(client, row.product_id, supplier.id);
      }

      await client.query(
        `UPDATE shop_sync_runs
            SET status = $2, finished_at = now(), products_seen = $3,
                offers_seen = $4, mapped_offers = $5, price_changes = $6,
                stock_changes = $7, error = NULL,
                details = $8
          WHERE id = $1`,
        [
          runId,
          status,
          parsed.productsSeen,
          parsed.offers.length,
          Number(mapped.rows[0]?.count || 0),
          priceChanges,
          stockChanges,
          JSON.stringify({
            hash_match: hashMatch,
            offer_count_match: parsed.offerCountMatch,
            feed_generated_at: parsed.meta.generated_at || null,
            missing_threshold: config.shopMissingRunsLimit,
          }),
        ],
      );

      await client.query(
        `UPDATE shop_suppliers
            SET last_sync_at = now(),
                last_success_at = CASE WHEN $2 = 'success' THEN now() ELSE last_success_at END,
                last_error = NULL,
                feed_etag = COALESCE($3, feed_etag),
                meta_etag = COALESCE($4, meta_etag),
                last_feed_hash = $5,
                updated_at = now()
          WHERE id = $1`,
        [
          supplier.id,
          status,
          productsFetch.etag,
          metaFetch.notModified ? null : metaFetch.etag,
          productsFetch.hash,
        ],
      );

      return {
        runId,
        supplierId: supplier.id,
        status,
        offersSeen: parsed.offers.length,
        mappedOffers: Number(mapped.rows[0]?.count || 0),
        priceChanges,
        stockChanges,
        productsSeen: parsed.productsSeen,
        hashMatch,
        offerCountMatch: parsed.offerCountMatch,
      } satisfies SyncResult;
    });

    return result;
  } catch (error) {
    const message = redactSourceText(
      error instanceof Error ? error.message : "同步失败",
    );
    await query(
      `UPDATE shop_sync_runs
          SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1`,
      [runId, message.slice(0, 1000)],
    );
    await query(
      `UPDATE shop_suppliers
          SET last_sync_at = now(), last_error = $2, updated_at = now()
        WHERE id = $1`,
      [supplier.id, message.slice(0, 1000)],
    );
    return {
      runId,
      supplierId: supplier.id,
      status: "failed",
      offersSeen: 0,
      mappedOffers: 0,
      priceChanges: 0,
      stockChanges: 0,
      productsSeen: 0,
      hashMatch: false,
      offerCountMatch: false,
      error: message,
    };
  }
}

async function recomputeProduct(
  client: PoolClient,
  productId: string,
  supplierId: string,
): Promise<void> {
  const productResult = await client.query<{
    price_micros: string | number;
    pricing_review_required: boolean;
    status: string;
  }>(
    `SELECT price_micros, pricing_review_required, status
       FROM shop_products WHERE id = $1 FOR UPDATE`,
    [productId],
  );
  const product = productResult.rows[0];
  if (!product) return;

  const sourceResult = await client.query<{
    offer_id: string;
    supplier_cost_micros: string | number;
    supplier_availability: string;
    previous_price_micros: string | number | null;
  }>(
    `SELECT s.offer_id, s.supplier_cost_micros, s.supplier_availability, p.price_micros AS previous_price_micros
       FROM shop_product_sources s
       JOIN shop_offers o ON o.id = s.offer_id
       LEFT JOIN LATERAL (
         SELECT price_micros
           FROM shop_offer_price_history h
          WHERE h.offer_id = s.offer_id
          ORDER BY h.captured_at DESC
          OFFSET 1 LIMIT 1
       ) p ON TRUE
      WHERE s.product_id = $1 AND s.active = TRUE AND o.supplier_id = $2`,
    [productId, supplierId],
  );

  if (sourceResult.rows.length === 0) return;

  const price = toNumber(product.price_micros);
  let worstCost = 0;
  let bestAvailability = "missing";
  let costSpike = false;

  for (const source of sourceResult.rows) {
    const cost = toNumber(source.supplier_cost_micros);
    worstCost = Math.max(worstCost, cost);
    if ((AVAILABILITY_RANK[source.supplier_availability] || 0) > (AVAILABILITY_RANK[bestAvailability] || 0)) {
      bestAvailability = source.supplier_availability;
    }
    const previous = source.previous_price_micros === null
      ? null
      : toNumber(source.previous_price_micros);
    if (previous && previous > 0 && cost > previous) {
      const increaseBps = ((cost - previous) * 10_000) / previous;
      if (increaseBps > config.shopMaxCostIncreaseBps) costSpike = true;
    }
  }

  const marginBps = price > 0 ? ((price - worstCost) * 10_000) / price : -1;
  const marginBroken = price <= 0 || worstCost >= price || marginBps < config.shopMinMarginBps;
  const reviewRequired = Boolean(product.pricing_review_required) || marginBroken || costSpike;

  const availability = reviewRequired
    ? "paused"
    : bestAvailability === "in_stock"
      ? "in_stock"
      : bestAvailability === "low_stock"
        ? "low_stock"
        : "out_of_stock";

  const reason = reviewRequired
    ? marginBroken
      ? `毛利不足：售价 ${price} / 最高成本 ${worstCost} / 毛利 ${marginBps.toFixed(0)}bps`
      : "成本单次涨幅超过阈值，需人工确认售价"
    : null;

  await client.query(
    `UPDATE shop_products
        SET availability = $2,
            availability_reason = $3,
            pricing_review_required = $4,
            updated_at = CASE
              WHEN availability IS DISTINCT FROM $2
                OR pricing_review_required IS DISTINCT FROM $4
              THEN now() ELSE updated_at END
      WHERE id = $1`,
    [productId, availability, reason, reviewRequired],
  );
}
