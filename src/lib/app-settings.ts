import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query } from "@/lib/db";

/**
 * Small encrypted key/value store for admin-managed integrations.
 * Secrets never leave the server: callers must not render the stored value.
 */
export async function getAppSetting<T>(key: string): Promise<T | null> {
  const result = await query<{ value_encrypted: string }>(
    "SELECT value_encrypted FROM app_settings WHERE key = $1",
    [key],
  );
  const row = result.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(decryptSecret(row.value_encrypted)) as T;
  } catch (error) {
    console.warn(
      "[app-settings] unable to decrypt",
      key,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function saveAppSetting(
  key: string,
  value: unknown,
  adminId: string | null,
): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value_encrypted, updated_by)
     VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE
     SET value_encrypted = EXCLUDED.value_encrypted,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
    [key, encryptSecret(JSON.stringify(value)), adminId],
  );
}
