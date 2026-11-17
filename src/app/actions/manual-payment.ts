"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { fulfillOrder } from "@/lib/orders";
import { parseYuanMicros, receiptReference, validOrderId } from "@/lib/payments/validation";
import { notifyShopManualPaymentReported } from "@/lib/shop/notify";
import { attachPaymentImages, MAX_PAYMENT_IMAGES } from "@/lib/shop/payment-images";
import { saveSupportImage, SupportImageError } from "@/lib/support/images";

export type ManualPaymentState = { error?: string; saved?: boolean };

/**
 * 取出客户上传的付款成功截图并落库。
 *
 * 截图是运营对账的「人证」：付款时间、金额、备注里的订单号都在上面。
 * 逐张做 magic bytes 校验，任何一张不合法就整条拒绝——不静默丢弃，
 * 否则客户以为发出去了，运营却对不上账。
 */
async function savePaymentImages(form: FormData): Promise<string[]> {
  const files = form
    .getAll("images")
    .filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) return [];
  if (files.length > MAX_PAYMENT_IMAGES) {
    throw new SupportImageError(`最多上传 ${MAX_PAYMENT_IMAGES} 张付款截图`);
  }
  const hashes: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    hashes.push(await saveSupportImage(bytes, file.name));
  }
  return hashes;
}

export async function submitManualPaymentClaimAction(_prev: ManualPaymentState, form: FormData): Promise<ManualPaymentState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId") || "");
  const shop = form.get("orderKind") === "shop";
  if (!validOrderId(orderId)) return { error: "订单号无效" };
  let imageHashes: string[] = [];
  try {
    const reference = receiptReference(String(form.get("reference") || ""));
    const note = String(form.get("payerNote") || "").trim();
    if (note.length > 200) return { error: "备注最多 200 字" };
    imageHashes = shop ? await savePaymentImages(form) : [];
    if (shop && imageHashes.length === 0) {
      return {
        error:
          "请上传支付宝付款成功的截图（要能看到付款时间和订单号）。没有截图请提交站内工单联系客服。",
      };
    }
    await withTransaction(async (client) => {
      const order = await client.query(
        shop ? "SELECT id FROM shop_orders WHERE id=$1 AND user_id=$2 AND status='pending_payment' AND payment_provider='alipay_manual' FOR UPDATE"
          : "SELECT id FROM orders WHERE id=$1 AND user_id=$2 AND status='pending' AND payment_provider='alipay_manual' FOR UPDATE", [orderId, user.id],
      );
      if (!order.rows[0]) throw new Error("订单不可提交，请刷新页面");
      await client.query(
        `UPDATE manual_alipay_payments SET reported_reference=$2, payer_note=$3, reported_at=now() WHERE order_id=$1`,
        [orderId, reference, note],
      );
    });
  } catch (error) {
    if (error instanceof SupportImageError) return { error: error.message };
    return { error: error instanceof Error && !('code' in error) ? error.message : "提交失败，请稍后重试" };
  }
  // 截图挂在订单上，运营在对账台和订单详情都能直接看。
  if (shop && imageHashes.length > 0) {
    try {
      await attachPaymentImages(orderId, imageHashes);
    } catch {
      // 截图挂载失败不影响付款申报本身，运营仍可按交易号对账。
    }
  }
  // The operator must verify in the Alipay bill; tell them a claim arrived.
  if (shop) void notifyShopManualPaymentReported(orderId);
  revalidatePath(`/dashboard/billing/alipay/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/shop/checkout/[orderNo]", "page");
  revalidatePath("/admin/shop/orders/[id]", "page");
  return { saved: true };
}

export async function reviewManualPaymentAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orderId = String(form.get("orderId") || "");
  if (!validOrderId(orderId)) redirect("/admin/orders?error=订单号无效");
  let errorMessage = "";
  let pending = false;
  try {
    if (form.get("checked") !== "on") throw new Error("请先在自己的收款账单确认实际到账");
    const reference = receiptReference(String(form.get("receiptRef") || ""));
    const amount = parseYuanMicros(String(form.get("amountYuan") || "").trim());
    const result = await fulfillOrder(orderId, { adminId: admin.id, reference, amountMicros: amount.toString() });
    pending = result.creditStatus !== "applied";
  } catch (error) {
    errorMessage = error instanceof Error && !('code' in error)
      ? error.message : "核账失败：该交易号可能已经用于其他订单，请核对后重试";
  }
  if (errorMessage) redirect(`/admin/payments/review/${orderId}?error=${encodeURIComponent(errorMessage)}`);
  revalidatePath("/admin/orders");
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard/membership");
  revalidatePath(`/dashboard/billing/alipay/${orderId}`);
  redirect(`/admin/orders?saved=1${pending ? "&creditPending=1" : ""}`);
}
