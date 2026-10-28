import { config } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, withTransaction } from "@/lib/db";

type Channel = "alipay_manual" | "usdt_trc20";
type StoredSettings = { enabled: boolean; payload_encrypted: string };
export type ManualAlipaySettings = { enabled: boolean; payee: string; qrDataUrl: string };

async function readSettings(channel: Channel) {
  const result = await query<StoredSettings>(
    "SELECT enabled, payload_encrypted FROM payment_settings WHERE channel = $1", [channel],
  );
  const row = result.rows[0];
  return row ? { enabled: row.enabled, data: JSON.parse(decryptSecret(row.payload_encrypted)) as Record<string, string> } : null;
}

export async function getManualAlipaySettings(): Promise<ManualAlipaySettings> {
  const saved = await readSettings("alipay_manual");
  return { enabled: saved?.enabled ?? false, payee: saved?.data.payee || "", qrDataUrl: saved?.data.qrDataUrl || "" };
}

export async function getUsdtSettings(): Promise<typeof config> {
  const saved = await readSettings("usdt_trc20");
  if (!saved) return config;
  return { ...config, usdtEnabled: saved.enabled, usdtXpub: saved.data.xpub || "", usdtTronGridApiKey: saved.data.apiKey || "" };
}

export async function savePaymentSettings(channel: Channel, enabled: boolean, data: Record<string, string>, adminId: string) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO payment_settings (channel, enabled, payload_encrypted, updated_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (channel) DO UPDATE
       SET enabled = EXCLUDED.enabled, payload_encrypted = EXCLUDED.payload_encrypted,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [channel, enabled, encryptSecret(JSON.stringify(data)), adminId],
    );
    await client.query("INSERT INTO payment_settings_audit (channel, enabled, admin_id) VALUES ($1,$2,$3)", [channel, enabled, adminId]);
  });
}
