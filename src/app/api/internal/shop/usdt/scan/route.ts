import { config } from "@/lib/config";
import { scanShopUsdtDeposits } from "@/lib/shop/usdt";
import { notifyShopOpsOnce } from "@/lib/shop/ops-alert";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();
  try {
    const result = await scanShopUsdtDeposits();
    if (result.errors > 0) {
      void notifyShopOpsOnce(
        "shop_usdt_scan_errors",
        [
          "【CokeAI 小店】USDT 扫描存在失败记录",
          `本轮失败：${result.errors} 笔`,
          `待人工：${result.manual} 笔`,
          `后台：${config.appUrl}/admin/shop/deposits`,
          "请检查 RPC 服务与容器日志。",
        ].join("\n"),
      );
    }
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[shop-usdt] scan route failed", error);
    void notifyShopOpsOnce(
      "shop_usdt_scan_failed",
      [
        "【CokeAI 小店】USDT 扫描任务失败",
        `错误：${error instanceof Error ? error.message : "未知错误"}`,
        `后台：${config.appUrl}/admin/shop/deposits`,
      ].join("\n"),
    );
    return Response.json(
      { ok: false, error: "scan_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
