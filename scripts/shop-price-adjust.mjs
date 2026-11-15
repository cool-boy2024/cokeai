#!/usr/bin/env node
/**
 * Raise (or lower) every on-sale shop price by the same CNY amount.
 *
 * Scope: shop_products with status = 'active', plus their active variants.
 * Drafts, paused and archived products are never touched.
 *
 * The update sets price_locked = TRUE so the 6-hourly zyanai sync cannot
 * recompute and undo the new price. Operators can hand a single product back
 * to automatic pricing with "恢复自动定价" in the admin product page.
 *
 * Usage (dry run is the default):
 *   node scripts/shop-price-adjust.mjs --add 3
 *   node scripts/shop-price-adjust.mjs --add 3 --apply
 *   node scripts/shop-price-adjust.mjs --add 3 --apply --backup /tmp/prices.json
 *
 * --add       amount in CNY, may be negative, two decimals max
 * --apply     actually commit; without it the transaction is rolled back
 * --backup    write the old prices to this JSON file before updating
 * --no-lock   do not set price_locked (the next sync may revert the change)
 */
import { writeFileSync } from "node:fs";
import { Client } from "pg";

function parseArgs(argv) {
  const options = { add: null, apply: false, backup: null, lock: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--no-lock") options.lock = false;
    else if (arg === "--add") options.add = argv[++i];
    else if (arg === "--backup") options.backup = argv[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function yuan(micros) {
  return `¥${(Number(micros) / 1_000_000).toFixed(2)}`;
}

function marginPct(priceMicros, costMicros) {
  if (!(priceMicros > 0)) return "—";
  const cost = Number(costMicros) || 0;
  return `${(((priceMicros - cost) / priceMicros) * 100).toFixed(1)}%`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.add) {
    console.log(
      [
        "用法：node scripts/shop-price-adjust.mjs --add <人民币元> [--apply] [--backup 文件] [--no-lock]",
        "",
        "示例：node scripts/shop-price-adjust.mjs --add 3 --apply",
        "默认只演练，不写库；加 --apply 才提交。",
      ].join("\n"),
    );
    process.exit(options.help ? 0 : 1);
  }

  const addMicros = Math.round(Number(options.add) * 1_000_000);
  if (!Number.isFinite(addMicros) || addMicros === 0) {
    throw new Error(`--add 必须是正数或负数的元金额，收到：${options.add}`);
  }
  if (Math.abs(Number(options.add) * 100 - Math.round(Number(options.add) * 100)) > 1e-9) {
    throw new Error("--add 最多两位小数");
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "shop-price-adjust",
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    const products = await client.query(
      `SELECT p.id, p.slug, p.name, p.price_micros, p.price_locked,
              MIN(s.supplier_cost_micros)::bigint AS cost_micros
         FROM shop_products p
         LEFT JOIN shop_product_sources s ON s.product_id = p.id AND s.active = TRUE
        WHERE p.status = 'active'
        GROUP BY p.id
        ORDER BY p.sort_order, p.created_at`,
    );
    const variants = await client.query(
      `SELECT v.id, v.product_id, v.label, v.price_micros
         FROM shop_product_variants v
         JOIN shop_products p ON p.id = v.product_id
        WHERE p.status = 'active' AND v.active = TRUE
        ORDER BY v.product_id, v.sort_order`,
    );

    if (products.rows.length === 0) {
      console.log("没有在售商品，未做任何修改。");
      await client.query("ROLLBACK");
      return;
    }

    if (options.backup) {
      writeFileSync(
        options.backup,
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            addMicros,
            products: products.rows.map((r) => ({
              id: r.id,
              slug: r.slug,
              price_micros: r.price_micros,
            })),
            variants: variants.rows.map((r) => ({
              id: r.id,
              product_id: r.product_id,
              price_micros: r.price_micros,
            })),
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`旧价格已备份到 ${options.backup}`);
    }

    console.log(
      `\n在售商品 ${products.rows.length} 个，在售规格 ${variants.rows.length} 个，价格统一 ${addMicros > 0 ? "+" : ""}${yuan(addMicros)}\n`,
    );
    console.log("商品价格变化：");
    for (const row of products.rows) {
      const before = Number(row.price_micros);
      const after = Math.max(before + addMicros, 10_000);
      console.log(
        `  ${row.slug.padEnd(36)} ${yuan(before).padStart(11)} → ${yuan(after).padStart(11)}  毛利 ${marginPct(before, row.cost_micros)} → ${marginPct(after, row.cost_micros)}`,
      );
    }
    if (variants.rows.length > 0) {
      console.log("\n规格价格变化：");
      const byProduct = new Map();
      for (const row of variants.rows) {
        const list = byProduct.get(row.product_id) || [];
        list.push(row);
        byProduct.set(row.product_id, list);
      }
      for (const [productId, list] of byProduct) {
        const product = products.rows.find((r) => r.id === productId);
        console.log(`  ${product ? product.slug : productId}`);
        for (const variant of list) {
          const before = Number(variant.price_micros);
          console.log(
            `    ${variant.label}: ${yuan(before)} → ${yuan(Math.max(before + addMicros, 10_000))}`,
          );
        }
      }
    }

    const productUpdate = await client.query(
      `UPDATE shop_products
          SET price_micros = GREATEST(price_micros + $1, 10000),
              price_locked = CASE WHEN $2 THEN TRUE ELSE price_locked END,
              price_locked_at = CASE WHEN $2 THEN now() ELSE price_locked_at END,
              updated_at = now()
        WHERE status = 'active'`,
      [addMicros, options.lock],
    );
    const variantUpdate = await client.query(
      `UPDATE shop_product_variants v
          SET price_micros = GREATEST(v.price_micros + $1, 10000)
         FROM shop_products p
        WHERE p.id = v.product_id
          AND p.status = 'active'
          AND v.active = TRUE`,
      [addMicros],
    );

    if (options.apply) {
      await client.query("COMMIT");
      console.log(
        `\n已提交：商品 ${productUpdate.rowCount} 个，规格 ${variantUpdate.rowCount} 个。` +
          (options.lock
            ? "\n这些商品已标记为手动售价，定时同步不会覆盖。"
            : "\n未加价格锁：下一次 zyanai 同步可能覆盖商品价格。"),
      );
    } else {
      await client.query("ROLLBACK");
      console.log(
        `\n演练完成，未写库（应更新商品 ${productUpdate.rowCount} 个，规格 ${variantUpdate.rowCount} 个）。` +
          "\n确认无误后加 --apply 执行。",
      );
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
