import { getAppSetting, saveAppSetting } from "@/lib/app-settings";
import { config } from "@/lib/config";
import { query } from "@/lib/db";

/**
 * Admin-configurable shop runtime settings.
 *
 * The supplier feed URL is a sourcing secret: it reveals where the catalogue
 * comes from, so it is stored encrypted in `app_settings` and never rendered
 * back into the admin page. Legacy rows that still carry a plaintext
 * `shop_suppliers.feed_url` are migrated into the encrypted store the first
 * time settings are read, and the plaintext columns are cleared.
 *
 * The target margin also lives in the encrypted store. Both fall back to the
 * .env-backed `config` defaults until an operator sets them, so existing
 * deployments keep working unchanged.
 */

const TARGET_MARGIN_KEY = "shop.target_margin_bps";
const FEED_URL_KEY = "shop.feed_url";
const FEED_META_URL_KEY = "shop.feed_meta_url";

export type ShopSourceSettings = {
  feedUrl: string;
  feedMetaUrl: string;
};

/** Status only: safe to hand to the admin page without revealing the URLs. */
export type ShopSourceStatus = {
  feedUrlConfigured: boolean;
  feedMetaUrlConfigured: boolean;
};

type LegacySupplierRow = {
  id: string;
  feed_url: string | null;
  meta_url: string | null;
};

async function legacySupplier(): Promise<LegacySupplierRow | null> {
  const result = await query<LegacySupplierRow>(
    `SELECT id, feed_url, meta_url
       FROM shop_suppliers
      WHERE kind = 'aibijia'
      ORDER BY created_at
      LIMIT 1`,
  );
  return result.rows[0] || null;
}

/**
 * Move any plaintext feed URLs written by older builds into the encrypted
 * store. Idempotent: once the columns are NULL this is a no-op.
 */
async function migrateLegacyFeedUrls(): Promise<void> {
  const supplier = await legacySupplier();
  if (!supplier) return;
  const [storedFeed, storedMeta] = await Promise.all([
    getAppSetting<string>(FEED_URL_KEY),
    getAppSetting<string>(FEED_META_URL_KEY),
  ]);
  const feedUrl = (storedFeed || supplier.feed_url || "").trim();
  const metaUrl = (storedMeta || supplier.meta_url || "").trim();
  if (!feedUrl && !metaUrl) return;
  await Promise.all([
    feedUrl && feedUrl !== storedFeed
      ? saveAppSetting(FEED_URL_KEY, feedUrl, null)
      : Promise.resolve(),
    metaUrl && metaUrl !== storedMeta
      ? saveAppSetting(FEED_META_URL_KEY, metaUrl, null)
      : Promise.resolve(),
  ]);
  if (supplier.feed_url || supplier.meta_url) {
    await query(
      `UPDATE shop_suppliers
          SET feed_url = NULL, meta_url = NULL, updated_at = now()
        WHERE id = $1`,
      [supplier.id],
    );
  }
}

/** Decrypted URLs for server-side use only. Never render this in a page. */
export async function getShopSourceSettings(): Promise<ShopSourceSettings> {
  await migrateLegacyFeedUrls();
  const [feedUrl, feedMetaUrl] = await Promise.all([
    getAppSetting<string>(FEED_URL_KEY),
    getAppSetting<string>(FEED_META_URL_KEY),
  ]);
  return {
    feedUrl: (feedUrl || "").trim() || config.shopFeedUrl,
    feedMetaUrl: (feedMetaUrl || "").trim() || config.shopFeedMetaUrl,
  };
}

/** Configured flags for the admin form; no URL leaves the server. */
export async function getShopSourceStatus(): Promise<ShopSourceStatus> {
  await migrateLegacyFeedUrls();
  const [feedUrl, feedMetaUrl] = await Promise.all([
    getAppSetting<string>(FEED_URL_KEY),
    getAppSetting<string>(FEED_META_URL_KEY),
  ]);
  return {
    feedUrlConfigured: Boolean((feedUrl || "").trim()),
    feedMetaUrlConfigured: Boolean((feedMetaUrl || "").trim()),
  };
}

export async function getShopTargetMarginBps(): Promise<number> {
  const stored = await getAppSetting<number>(TARGET_MARGIN_KEY);
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  return config.shopImportTargetMarginBps;
}

/**
 * Encrypted URL storage. Empty values keep the current setting, so an admin
 * can change the margin without re-entering (or ever seeing) the URL.
 */
export async function saveShopSourceSettings(
  input: { feedUrl?: string; feedMetaUrl?: string; clear?: boolean },
  adminId: string,
): Promise<void> {
  if (input.clear) {
    await Promise.all([
      saveAppSetting(FEED_URL_KEY, "", adminId),
      saveAppSetting(FEED_META_URL_KEY, "", adminId),
    ]);
    return;
  }
  const feedUrl = (input.feedUrl || "").trim();
  const feedMetaUrl = (input.feedMetaUrl || "").trim();
  await Promise.all([
    feedUrl ? saveAppSetting(FEED_URL_KEY, feedUrl, adminId) : Promise.resolve(),
    feedMetaUrl ? saveAppSetting(FEED_META_URL_KEY, feedMetaUrl, adminId) : Promise.resolve(),
  ]);
}

export async function saveShopTargetMarginBps(bps: number, adminId: string): Promise<void> {
  await saveAppSetting(TARGET_MARGIN_KEY, bps, adminId);
}
