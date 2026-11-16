import { config } from "@/lib/config";
import {
  expireShopOrders,
  flagUnreportedManualAlipayOrders,
  purgeDeliveredCustomerInputs,
} from "@/lib/shop/orders";
import { notifyShopOpsOnce } from "@/lib/shop/ops-alert";
import { unauthorized, verifyInternalSecret } from "@/lib/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalSecret(request)) return unauthorized();

  try {
    const expired = await expireShopOrders();
    // Manual Alipay orders are never auto-expired (the money may already be in
    // the merchant account), so they need a human. Flag the ones past their
    // deadline without a buyer report and alert the operator once.
    const flagged = await flagUnreportedManualAlipayOrders();
    const purged = await purgeDeliveredCustomerInputs();
    return Response.json(
      { ok: true, expired, flagged: flagged.length, purged },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[shop-orders] expire route failed", error);
    void notifyShopOpsOnce(
      "shop_order_expire_failed",
      [
        "【CokeAI 小店】订单过期任务失败",
        `错误：${error instanceof Error ? error.message : "未知错误"}`,
        `后台：${config.appUrl}/admin/shop/orders`,
        "未支付订单可能不会自动关闭，请检查容器日志。",
      ].join("\n"),
    );
    return Response.json(
      { ok: false, error: "expire_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
