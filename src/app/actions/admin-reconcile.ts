"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { decodeStatement, parseAlipayStatement } from "@/lib/shop/alipay-statement";
import { importAlipayStatement, settleStatementRow } from "@/lib/shop/reconcile";

/** 一份月度账单大约几百 KB，8MB 足够，也挡住误传的大文件。 */
const MAX_STATEMENT_BYTES = 8 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function adminImportAlipayStatementAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const file = formData.get("statement");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/shop/reconcile?error=${encodeURIComponent("请选择支付宝账单文件")}`);
  }
  if (file.size > MAX_STATEMENT_BYTES) {
    redirect(
      `/admin/shop/reconcile?error=${encodeURIComponent("账单文件不能超过 8MB")}`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseAlipayStatement(decodeStatement(bytes));
  if (parsed.rows.length === 0) {
    const reason = parsed.warnings[0] || "账单里没有可导入的收入记录";
    redirect(`/admin/shop/reconcile?error=${encodeURIComponent(reason)}`);
  }

  const summary = await importAlipayStatement({ adminId: admin.id, rows: parsed.rows });

  revalidatePath("/admin/shop/reconcile");
  const params = new URLSearchParams({
    imported: String(summary.inserted),
    duplicates: String(summary.duplicates),
    matched: String(summary.matchedOrderNo + summary.matchedAmount),
    ambiguous: String(summary.ambiguous),
    unmatched: String(summary.unmatched),
  });
  redirect(`/admin/shop/reconcile?${params.toString()}`);
}

export async function adminSettleStatementRowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const rowId = String(formData.get("rowId") || "");
  const orderNo = String(formData.get("orderNo") || "").trim().toUpperCase();
  if (!UUID_PATTERN.test(rowId)) {
    redirect(`/admin/shop/reconcile?error=${encodeURIComponent("流水编号无效")}`);
  }
  if (!orderNo) {
    redirect(`/admin/shop/reconcile?error=${encodeURIComponent("请选择要入账的订单")}`);
  }

  let errorMessage = "";
  try {
    await settleStatementRow({ adminId: admin.id, rowId, orderNo });
  } catch (error) {
    errorMessage =
      error instanceof Error && !("code" in error)
        ? error.message
        : "入账失败：请核对金额和订单状态";
  }
  if (errorMessage) {
    redirect(`/admin/shop/reconcile?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath("/admin/shop/reconcile");
  revalidatePath("/admin/shop/orders");
  revalidatePath("/shop/orders/[orderNo]", "page");
  redirect(`/admin/shop/reconcile?saved=${encodeURIComponent(orderNo)}`);
}
