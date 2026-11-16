import { getCurrentUser } from "@/lib/auth";
import { countUnreadMessagesForAdmin } from "@/lib/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sidebar badge source. The admin layout is a cached shell, so after a ticket
 * detail page marks everything read the shell keeps the old number until a
 * full reload. The badge polls this to stay correct.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    // Same 404 a non-admin sees for any unknown path.
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const count = await countUnreadMessagesForAdmin();
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
