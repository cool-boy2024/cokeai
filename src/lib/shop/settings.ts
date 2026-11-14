import { getAppSetting, saveAppSetting } from "@/lib/app-settings";
import { config } from "@/lib/config";
import { query } from "@/lib/db";

/**
 * Admin-configurable shop runtime settings.
 *
 * The supplier feed URL lives on the aibijia supplier row (the sync already
 * reads `feed_url || config.shopFeedUrl`), so editing it here takes effect on
 * the next sync without redeploying. The target margin lives in the encrypted
 * app_settings store. Both fall back to the .env-backed `config` defaults until
 * an operator sets them, so existing deployments keep working unchanged.
 */

const TARGET_MARGIN_KEY = "shop.target_margin_bps";

export type ShopSourceSettings = {
  feedUrl: string;
  feedMetaUrl: string;
};

export async function getShopSourceSettings(): Promise<ShopSourceSettings> {
  const result = await query<{ feed_url: string | null; meta_url: string | null }>(
    `SELECT feed_url, meta_url
       FROM shop_suppliers
      WHERE kind = 'aibijia'
      ORDER BY created_at
      LIMIT 1`,
  );
  const row = result.rows[0];
  return {
    feedUrl: row?.feed_url || config.shopFeedUrl,
    feedMetaUrl: row?.meta_url || config.shopFeedMetaUrl,
  };
}

export async function getShopTargetMarginBps(): Promise<number> {
  const stored = await getAppSetting<number>(TARGET_MARGIN_KEY);
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  return config.shopImportTargetMarginBps;
}

export async function saveShopSourceSettings(
  input: { feedUrl: string; feedMetaUrl: string },
): Promise<void> {
  const feedUrl = input.feedUrl.trim() || null;
  const feedMetaUrl = input.feedMetaUrl.trim() || null;

  const existing = await query<{ id: string }>(
    `SELECT id FROM shop_suppliers WHERE kind = 'aibijia' LIMIT 1`,
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE shop_suppliers
          SET feed_url = $2, meta_url = $3, updated_at = now()
        WHERE id = $1`,
      [existing.rows[0].id, feedUrl, feedMetaUrl],
    );
  } else {
    await query(
      `INSERT INTO shop_suppliers (name, kind, feed_url, meta_url)
       VALUES ('Aibijia', 'aibijia', $1, $2)`,
      [feedUrl, feedMetaUrl],
    );
  }
}

export async function saveShopTargetMarginBps(bps: number, adminId: string): Promise<void> {
  await saveAppSetting(TARGET_MARGIN_KEY, bps, adminId);
}
