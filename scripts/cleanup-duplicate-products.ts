import { loadEnv } from "./env.mjs";

loadEnv();

/**
 * 清理同一货源下重复的商品行。
 *
 * 背景：品牌识别规则改过之后 slug 会变（p-155 → p-155-gemini），旧同步按
 * slug 做 upsert，于是新建了一行，旧的那个一直挂在线上且永远没有库存/销量。
 * 前台看到的就是「有商品但没有已售/库存」。
 *
 * 这个脚本按 external_key 分组，每组保留「最近同步过的那一行」，把其余的
 * 归档（status = 'archived'）。**不删除**：订单可能引用它，而且归档是可逆的。
 *
 *   npm run shop:dedupe          # 只列出会做什么
 *   npm run shop:dedupe -- --apply   # 真正归档
 */

type Row = {
  external_key: string;
  id: string;
  slug: string;
  status: string;
  supplier_synced_at: string | null;
  supplier_sold: number;
  order_items: string;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const { query } = await import("../src/lib/db");

  const dupes = await query<{ external_key: string }>(
    `SELECT o.external_key
       FROM shop_products p
       JOIN shop_product_sources s ON s.product_id = p.id
       JOIN shop_offers o ON o.id = s.offer_id
      GROUP BY o.external_key
     HAVING count(*) > 1`,
  );

  if (dupes.rows.length === 0) {
    console.log("没有重复商品。");
    return;
  }

  let archived = 0;
  for (const { external_key } of dupes.rows) {
    const rows = await query<Row>(
      `SELECT p.id, p.slug, p.status, p.supplier_synced_at, p.supplier_sold,
              (SELECT count(*)::text FROM shop_order_items i WHERE i.product_id = p.id) AS order_items
         FROM shop_products p
         JOIN shop_product_sources s ON s.product_id = p.id
         JOIN shop_offers o ON o.id = s.offer_id
        WHERE o.external_key = $1
        ORDER BY p.supplier_synced_at DESC NULLS LAST, p.updated_at DESC`,
      [external_key],
    );

    // 保留同步过、且有销量的那一行；其余归档。
    const keep = rows.rows.find((row) => row.supplier_synced_at !== null) || rows.rows[0];
    const drop = rows.rows.filter((row) => row.id !== keep.id);

    console.log(`\n${external_key}`);
    console.log(`  保留 ${keep.slug} (sold=${keep.supplier_sold}, 订单 ${keep.order_items})`);
    for (const row of drop) {
      const hasOrders = Number(row.order_items) > 0;
      console.log(
        `  归档 ${row.slug} (sold=${row.supplier_sold}, 订单 ${row.order_items})${hasOrders ? " —— 有历史订单，仍会归档" : ""}`,
      );
      if (apply) {
        await query(
          `UPDATE shop_products
              SET status = 'archived', published_at = NULL, updated_at = now()
            WHERE id = $1`,
          [row.id],
        );
        archived += 1;
      }
    }
  }

  console.log(
    apply
      ? `\n已归档 ${archived} 个重复商品（可随时改回 active 恢复）。`
      : `\n共 ${dupes.rows.length} 组重复。加 --apply 执行归档。`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
