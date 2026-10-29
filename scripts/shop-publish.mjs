import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env.mjs";

loadEnv();

const args = new Set(process.argv.slice(2));
const isProduction = process.env.NODE_ENV === "production";
const confirmed = args.has("--confirm-production");
const publishNew = args.has("--publish-new");
const dryRun = args.has("--dry-run");

if (isProduction && !confirmed) {
  throw new Error(
    "生产环境写入商品文案需要 --confirm-production。先用 --dry-run 检查将要更新的商品。",
  );
}

const contentPath = path.join(process.cwd(), "scripts/shop-content.json");
const products = JSON.parse(fs.readFileSync(contentPath, "utf8"));
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

function micros(yuan) {
  return Math.round(Number(yuan) * 1_000_000);
}

function availabilityOf(offer) {
  return offer && ["in_stock", "low_stock"].includes(offer.availability)
    ? offer.availability
    : "out_of_stock";
}

await client.connect();

let updated = 0;
let created = 0;
let linked = 0;
let missingOffers = 0;

try {
  await client.query("BEGIN");

  const admin = await client.query(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1",
  );
  const adminId = admin.rows[0]?.id ?? null;
  if (publishNew && !adminId) {
    throw new Error("找不到可用的管理员账号，不能写入合规确认");
  }

  for (const product of products) {
    const offer = await client.query(
      `SELECT id, price_micros, availability
         FROM shop_offers
        WHERE source_store = $1 AND source_title ILIKE $2
        ORDER BY last_seen_at DESC
        LIMIT 1`,
      [product.offer.store, product.offer.titleLike],
    );
    const offerRow = offer.rows[0] ?? null;
    const manual = product.manualAvailability ?? null;

    const existing = await client.query(
      "SELECT id FROM shop_products WHERE slug = $1 LIMIT 1",
      [product.slug],
    );

    let productId;

    if (existing.rows[0]) {
      productId = existing.rows[0].id;
      // Existing products keep their status, price, availability and compliance
      // record; this pass only replaces the public copy and display fields.
      await client.query(
        `UPDATE shop_products
            SET brand = $2, category = $3, product_type = $4,
                name = $5, subtitle = $6, description = $7,
                cover_variant = $8, eta_min_minutes = $9, eta_max_minutes = $10,
                warranty_type = $11, warranty_days = $12, warranty_note = $13,
                includes = $14::jsonb, usage_notes = $15::jsonb,
                customer_notice = $16, refund_policy = $17,
                input_fields = $18::jsonb, featured = $19, sort_order = $20,
                availability = COALESCE($21, availability),
                copy_ready = TRUE, updated_at = now()
          WHERE id = $1`,
        [
          productId,
          product.brand,
          product.category,
          product.productType,
          product.name,
          product.subtitle,
          product.description,
          product.cover,
          product.etaMin,
          product.etaMax,
          product.warrantyType,
          product.warrantyDays,
          product.warrantyNote,
          JSON.stringify(product.includes),
          JSON.stringify(product.usage),
          product.notice,
          product.refund,
          JSON.stringify(product.inputFields),
          Boolean(product.featured),
          product.sort,
          manual,
        ],
      );
      updated += 1;
    } else {
      if (!offerRow && !manual) {
        console.warn(`skip ${product.slug}: no supplier offer, refusing to create an unsourced product`);
        missingOffers += 1;
        continue;
      }
      const active = publishNew;
      const inserted = await client.query(
        `INSERT INTO shop_products
           (slug, brand, category, product_type, name, subtitle, description,
            cover_variant, price_micros, delivery_method, eta_min_minutes,
            eta_max_minutes, warranty_type, warranty_days, warranty_note,
            includes, usage_notes, customer_notice, refund_policy, input_fields,
            status, availability, copy_ready, compliance_ack_at,
            compliance_ack_by, featured, sort_order, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,$13,$14,
                 $15::jsonb,$16::jsonb,$17,$18,$19::jsonb,$20,$21,TRUE,
                 CASE WHEN $20 = 'active' THEN now() ELSE NULL END,
                 CASE WHEN $20 = 'active' THEN $22::uuid ELSE NULL END,
                 $23,$24,
                 CASE WHEN $20 = 'active' THEN now() ELSE NULL END)
         RETURNING id`,
        [
          product.slug,
          product.brand,
          product.category,
          product.productType,
          product.name,
          product.subtitle,
          product.description,
          product.cover,
          micros(product.price),
          product.etaMin,
          product.etaMax,
          product.warrantyType,
          product.warrantyDays,
          product.warrantyNote,
          JSON.stringify(product.includes),
          JSON.stringify(product.usage),
          product.notice,
          product.refund,
          JSON.stringify(product.inputFields),
          active ? "active" : "draft",
          manual ?? availabilityOf(offerRow),
          adminId,
          Boolean(product.featured),
          product.sort,
        ],
      );
      productId = inserted.rows[0].id;
      created += 1;
    }

    if (offerRow) {
      const sourceActive = !manual;
      await client.query(
        `UPDATE shop_product_sources SET active = FALSE
          WHERE product_id = $1 AND offer_id <> $2`,
        [productId, offerRow.id],
      );
      if (manual) {
        await client.query(
          "UPDATE shop_product_sources SET active = FALSE WHERE product_id = $1",
          [productId],
        );
      }
      await client.query(
        `INSERT INTO shop_product_sources
           (product_id, offer_id, role, active, supplier_cost_micros,
            supplier_availability, last_synced_at)
         VALUES ($1, $2, 'primary', $5, $3, $4, now())
         ON CONFLICT (product_id, offer_id) DO UPDATE SET
           role = 'primary', active = EXCLUDED.active,
           supplier_cost_micros = EXCLUDED.supplier_cost_micros,
           supplier_availability = EXCLUDED.supplier_availability,
           last_synced_at = now()`,
        [
          productId,
          offerRow.id,
          offerRow.price_micros,
          offerRow.availability,
          sourceActive,
        ],
      );
      linked += 1;
    } else if (manual) {
      await client.query(
        "UPDATE shop_product_sources SET active = FALSE WHERE product_id = $1",
        [productId],
      );
    } else {
      console.warn(`warn ${product.slug}: supplier offer not found, content updated only`);
      missingOffers += 1;
    }
  }

  if (dryRun) {
    await client.query("ROLLBACK");
    console.log("dry run: rolled back");
  } else {
    await client.query("COMMIT");
  }

  console.log(
    JSON.stringify(
      { updated, created, linked, missingOffers, publishNew, dryRun },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
