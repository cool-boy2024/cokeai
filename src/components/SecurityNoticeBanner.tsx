import { getPublicSecurityNotice } from "@/lib/security";

/**
 * Customer-facing notice while temporary protection is tightening limits.
 * Counters, blocked paths and defense details stay on /admin/security.
 */
export async function SecurityNoticeBanner() {
  const message = await getPublicSecurityNotice();
  if (!message) return null;
  return (
    <div className="security-notice" role="status">
      <div className="container">
        <strong>提示</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
