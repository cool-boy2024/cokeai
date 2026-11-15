import { config } from "@/lib/config";

/**
 * Sync failures quote the URL they were fetching. Those messages end up in
 * `shop_suppliers.last_error` / `shop_sync_runs.error` and are shown in the
 * admin, so scrub every source address before the message leaves the sync
 * code — the feed address itself must never be readable from the UI or logs.
 */
export function redactSourceText(text: string): string {
  const hosts = new Set<string>();
  for (const candidate of [config.shopFeedUrl, config.shopFeedMetaUrl]) {
    try {
      if (candidate) hosts.add(new URL(candidate).host);
    } catch {
      // A malformed default is nothing to hide; the generic URL rule below
      // still covers it.
    }
  }
  let out = text;
  for (const host of hosts) out = out.split(host).join("数据源");
  return out.replace(/https?:\/\/[^\s"'<>]+/gi, "数据源");
}
