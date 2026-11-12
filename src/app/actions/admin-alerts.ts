"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  buildAlertConfig,
  getAlertConfig,
  saveAlertConfig,
  sendAlert,
} from "@/lib/alerts";

/**
 * Saves the alert channel and, when requested, immediately sends a test.
 * Secrets stay on the server; errors are returned as short codes/messages and
 * never include the webhook URL or SMTP password.
 */
export async function saveAlertSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const current = await getAlertConfig();
  const built = buildAlertConfig(
    {
      channel: String(formData.get("channel") || ""),
      webhookUrl: String(formData.get("webhookUrl") || ""),
      smtpHost: String(formData.get("smtpHost") || ""),
      smtpPort: String(formData.get("smtpPort") || ""),
      smtpUser: String(formData.get("smtpUser") || ""),
      smtpPass: String(formData.get("smtpPass") || ""),
      smtpFrom: String(formData.get("smtpFrom") || ""),
      smtpTo: String(formData.get("smtpTo") || ""),
    },
    current,
  );

  if ("error" in built) {
    redirect(`/admin/security/alerts?error=${encodeURIComponent(built.error)}`);
  }

  await saveAlertConfig(built.config, admin.id);

  if (String(formData.get("intent") || "") === "test") {
    const result = await sendAlert(
      [
        "CokeAI 告警通道测试",
        "这是管理员在后台手动触发的测试消息。",
        `时间：${new Date().toISOString()}`,
      ].join("\n"),
      { test: true },
    );
    redirect(
      `/admin/security/alerts?saved=1&test=${result.ok ? "sent" : "failed"}`,
    );
  }

  redirect("/admin/security/alerts?saved=1");
}
