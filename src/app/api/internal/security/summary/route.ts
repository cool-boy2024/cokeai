import { sendAlert } from "@/lib/alerts";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";
import {
  formatSecurityAlert,
  getSecuritySnapshot,
  issueAttackAlertIfDue,
  releaseAttackAlertCooldown,
  securityRecommendations,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Polled by n8n every 5 minutes. `mark=1` claims the alert cooldown so one
 * attack burst produces one message instead of one per poll.
 */
export async function GET(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  const snapshot = await getSecuritySnapshot(200);
  const mark = new URL(request.url).searchParams.get("mark") === "1";
  const shouldAlert =
    mark && snapshot.alertChannelConfigured
      ? await issueAttackAlertIfDue(snapshot)
      : false;
  // Deliver from the app so the channel configured in /admin/security/alerts
  // applies without giving n8n access to the webhook or SMTP secret.
  const alertResult = shouldAlert
    ? await sendAlert(formatSecurityAlert(snapshot), {
        attack: snapshot.attack,
        source: "cokeai-security",
      })
    : null;
  if (alertResult && !alertResult.ok) {
    await releaseAttackAlertCooldown();
  }

  return Response.json(
    {
      ok: true,
      available: snapshot.available,
      attack: snapshot.attack,
      status: snapshot.status,
      attack_reasons: snapshot.attackReasons,
      should_alert: shouldAlert,
      window_minutes: snapshot.windowMinutes,
      window_count: snapshot.windowCount,
      window_5m_count: snapshot.count5m,
      window_15m_count: snapshot.count15m,
      window_1h_count: snapshot.count1h,
      window_15m_by_type: snapshot.count15mByType,
      unique_ips_5m: snapshot.uniqueIps5m,
      unique_ips_15m: snapshot.uniqueIps15m,
      threshold: snapshot.threshold,
      today_total: snapshot.todayTotal,
      today_unique_ips: snapshot.todayUniqueIps,
      top_ips: snapshot.topIps,
      by_type: snapshot.byType,
      last_event_at: snapshot.lastEventAt,
      alert_cooldown_seconds: snapshot.alertCooldownSeconds,
      alert_channel_configured: snapshot.alertChannelConfigured,
      strict_mode: snapshot.strictMode,
      strict_seconds_remaining: snapshot.strictSecondsRemaining,
      defense_mode: snapshot.defenseMode,
      defense_seconds_remaining: snapshot.defenseSecondsRemaining,
      recommendations: securityRecommendations(snapshot),
      alert_sent: Boolean(alertResult?.ok),
      alert_error: alertResult?.error ?? null,
      alert_text: shouldAlert ? formatSecurityAlert(snapshot) : null,
      generated_at: new Date(snapshot.generatedAt).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
