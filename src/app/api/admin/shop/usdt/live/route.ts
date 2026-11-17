import { getCurrentUser } from "@/lib/auth";
import { scanShopUsdtDeposits } from "@/lib/shop/usdt";
import { loadUsdtLive } from "@/lib/shop/usdt-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 加密货币实时看板的数据口。
 *
 * GET 只读，给后台页面每 3 秒轮询；POST 触发一次真正的链上扫描，运营点
 * 「立即扫描」时用——不用等 n8n 的下一轮。
 *
 * 速度的物理上限在链上：BSC/Polygon 出块 2–3 秒、TRON 约 3 秒，但订单要等够
 * requiredConfirmations 才自动入账。所以「看到钱」是秒级，「可发货」仍要等
 * 确认数——看板把这两个阶段分开显示。
 */
async function adminDenied(): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new Response("Forbidden", { status: 403 });
  return null;
}

export async function GET(): Promise<Response> {
  const denied = await adminDenied();
  if (denied) return denied;
  const payload = await loadUsdtLive();
  return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(): Promise<Response> {
  const denied = await adminDenied();
  if (denied) return denied;
  let scan: Awaited<ReturnType<typeof scanShopUsdtDeposits>> | null = null;
  let scanError: string | null = null;
  try {
    scan = await scanShopUsdtDeposits();
  } catch (error) {
    scanError = error instanceof Error ? error.message : "扫描失败";
  }
  const payload = await loadUsdtLive();
  return Response.json(
    { ...payload, scan, scanError },
    { headers: { "Cache-Control": "no-store" } },
  );
}
