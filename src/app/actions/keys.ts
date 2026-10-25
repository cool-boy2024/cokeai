"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { generateApiKey } from "@/lib/crypto";
import { query, toNumber } from "@/lib/db";

export type KeyState = {
  error?: string;
  key?: string;
  prefix?: string;
};

const keySchema = z.object({
  name: z.string().trim().min(1, "请输入 Key 名称").max(40, "名称过长"),
});

export async function createKeyAction(
  _prev: KeyState,
  formData: FormData,
): Promise<KeyState> {
  const user = await requireUser();
  const parsed = keySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "名称无效" };
  }

  const count = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
    [user.id],
  );
  if (toNumber(count.rows[0]?.count) >= config.maxActiveApiKeys) {
    return { error: `最多同时保留 ${config.maxActiveApiKeys} 个可用 Key` };
  }

  const generated = generateApiKey();
  await query(
    `INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4)`,
    [user.id, parsed.data.name, generated.hash, generated.prefix],
  );
  revalidatePath("/dashboard/keys");
  return { key: generated.key, prefix: generated.prefix };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await query(
    `UPDATE api_keys
        SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, user.id],
  );
  revalidatePath("/dashboard/keys");
}
