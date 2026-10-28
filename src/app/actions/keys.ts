"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createKeyForUser,
  KeyActionError,
  revokeKeyForUser,
} from "@/lib/sub2api/keys";

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

  try {
    const created = await createKeyForUser(user.id, parsed.data.name);
    revalidatePath("/dashboard/keys");
    return { key: created.key, prefix: created.prefix };
  } catch (error) {
    if (error instanceof KeyActionError) {
      return { error: error.userMessage };
    }
    console.error("[keys] create failed", error);
    return { error: "创建 Key 失败，请稍后重试" };
  }
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  if (!id) return;

  try {
    await revokeKeyForUser(user.id, id);
  } catch (error) {
    console.error("[keys] revoke failed", error);
  }
  revalidatePath("/dashboard/keys");
}
