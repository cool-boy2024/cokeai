"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { syncHelpArticles } from "@/lib/help/sync";

/** Manual sync for /admin/help. The same library runs on the n8n schedule. */
export async function syncHelpAction(): Promise<void> {
  await requireAdmin();

  let query = "";
  try {
    const result = await syncHelpArticles();
    revalidatePath("/help");
    const params = new URLSearchParams({
      result: result.ok ? "ok" : "partial",
      added: String(result.added),
      updated: String(result.updated),
      hidden: String(result.hidden),
      checked: String(result.checked),
    });
    if (result.errors.length > 0) {
      params.set("error", result.errors.slice(0, 3).join("；").slice(0, 300));
    }
    query = params.toString();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "同步失败，请稍后重试";
    query = `result=failed&error=${encodeURIComponent(message.slice(0, 200))}`;
  }

  redirect(`/admin/help?${query}`);
}
