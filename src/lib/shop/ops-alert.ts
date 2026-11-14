import { sendAlert } from "@/lib/alerts";

const globalForShopOps = globalThis as unknown as {
  cokeaiShopOpsAlertAt?: Map<string, number>;
};

/**
 * Shop maintenance routes are driven by n8n, so a thrown error only shows up
 * in container logs. Send one operator alert per key per cooldown window
 * instead of failing silently or flooding the channel every five minutes.
 */
export async function notifyShopOpsOnce(
  key: string,
  text: string,
  cooldownMs = 30 * 60_000,
): Promise<void> {
  const now = Date.now();
  const sentAt = globalForShopOps.cokeaiShopOpsAlertAt || new Map<string, number>();
  globalForShopOps.cokeaiShopOpsAlertAt = sentAt;
  if (now - (sentAt.get(key) || 0) < cooldownMs) return;
  sentAt.set(key, now);

  const sent = await sendAlert(text, { event: key });
  if (!sent.ok) {
    console.warn("[shop] ops alert not delivered:", sent.error);
  }
}
