"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { fulfillOrder } from "@/lib/orders";
import { parseYuanMicros, receiptReference, validOrderId } from "@/lib/payments/validation";
import { notifyShopManualPaymentReported } from "@/lib/shop/notify";

export type ManualPaymentState = { error?: string; saved?: boolean };

export async function submitManualPaymentClaimAction(_prev: ManualPaymentState, form: FormData): Promise<ManualPaymentState> {
  const user = await requireUser();
  const orderId = String(form.get("orderId") || "");
  const shop = form.get("orderKind") === "shop";
  if (!validOrderId(orderId)) return { error: "订单号无效" };
  try {
    const reference = receiptReference(String(form.get("reference") || ""));
    const note = String(form.get("payerNote") || "").trim();
    if (note.length > 200) return { error: "备注最多 200 字" };
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
    return { error: error instanceof Error && !('code' in error) ? error.message : "提交失败，请稍后重试" };
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
  revalidatePath(`/dashboard/billing/alipay/${orderId}`);
  redirect(`/admin/orders?saved=1${pending ? "&creditPending=1" : ""}`);
}
