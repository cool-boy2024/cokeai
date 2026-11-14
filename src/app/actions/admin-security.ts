"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, revokeSession } from "@/lib/auth";
import {
  activateEmergencyDefense,
  deactivateEmergencyDefense,
  sendEmergencyDefenseNotice,
  sendSecuritySummaryAlert,
  sendSecurityTestAlert,
  setStrictMode,
} from "@/lib/security";

export async function sendSecurityTestAlertAction(): Promise<void> {
  await requireAdmin();
  const result = await sendSecurityTestAlert();
  redirect(`/admin/security?test=${result.ok ? "sent" : "failed"}`);
}

export async function sendSecuritySummaryAlertAction(): Promise<void> {
  await requireAdmin();
  const result = await sendSecuritySummaryAlert();
  redirect(`/admin/security?test=${result.ok ? "summary_sent" : "failed"}`);
}

export async function toggleStrictModeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const enabled = String(formData.get("mode") || "") === "on";
  const ok = await setStrictMode(enabled, 60);
  redirect(
    `/admin/security?mode=${ok ? (enabled ? "strict" : "normal") : "failed"}`,
  );
}

/**
 * Revokes one session by its token hash. Used by the admin session list so an
 * operator can kick a device without redeploying or resetting the password.
 */
export async function adminRevokeSessionAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const tokenHash = String(formData.get("tokenHash") || "").trim();
  if (tokenHash) await revokeSession(tokenHash);
  revalidatePath("/admin/security/sessions");
  redirect("/admin/security/sessions?revoked=1");
}

/**
 * One-button emergency switch for a real attack.
 *
 * It does two things immediately: halves application limits for 24 hours and
 * notifies the alert channel with the staged edge steps. Switching the
 * Cloudflare Tunnel stays a manual, approved production change.
 */
export async function toggleEmergencyDefenseAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const enabled = String(formData.get("mode") || "") === "on";
  const ok = enabled
    ? await activateEmergencyDefense(24)
    : await deactivateEmergencyDefense();
  if (ok) await sendEmergencyDefenseNotice(enabled);
  redirect(
    `/admin/security?defense=${ok ? (enabled ? "on" : "off") : "failed"}`,
  );
}
