import { getCurrentUser } from "@/lib/auth";
import { countUnreadMessagesForUser } from "@/lib/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 控制台侧栏「售后工单」角标的数据源，与运营端 /api/admin/support/unread
 * 对应：布局是缓存外壳，点进工单详情标记已读后靠这里刷新角标。
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { count: 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const count = await countUnreadMessagesForUser(user.id);
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
