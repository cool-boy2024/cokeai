import { listTickerItems } from "@/lib/shop/ticker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const items = await listTickerItems();
    return Response.json(
      { items },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[ticker]", error instanceof Error ? error.message : error);
    return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
