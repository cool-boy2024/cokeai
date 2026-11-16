"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  addAdminReply,
  addCustomerReply,
  createTicket,
  setTicketStatus,
} from "@/lib/support";
import {
  MAX_IMAGES_PER_MESSAGE,
  saveSupportImage,
  SupportImageError,
} from "@/lib/support/images";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

/**
 * 从表单里取出图片并保存。
 *
 * 客户要发收款码、报错截图，纯文字说不清。这里逐张校验（magic bytes + 大小），
 * 任何一张不合法就整条拒绝——不静默丢弃，否则客户以为发出去了。
 */
async function saveFormImages(formData: FormData): Promise<string[]> {
  const files = formData
    .getAll("images")
    .filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) return [];
  if (files.length > MAX_IMAGES_PER_MESSAGE) {
    throw new SupportImageError(`一条消息最多 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
  }
  const hashes: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    hashes.push(await saveSupportImage(bytes, file.name));
  }
  return hashes;
}

export async function createSupportTicketAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const subject = text(formData, "subject").slice(0, 200);
  const message = text(formData, "message").slice(0, 4000);
  const orderId = text(formData, "orderId") || null;

  // Keep the order association when the form fails validation, so the buyer
  // does not lose the context they arrived with.
  const backTo = orderId
    ? `/dashboard/support?orderId=${encodeURIComponent(orderId)}`
    : "/dashboard/support";

  if (!subject || !message) {
    redirect(`${backTo}&error=${encodeURIComponent("请填写标题和内容")}`);
  }

  if (orderId) {
    const owned = await query(
      "SELECT 1 FROM shop_orders WHERE id = $1 AND user_id = $2 LIMIT 1",
      [orderId, user.id],
    );
    if (!owned.rows[0]) {
      redirect(`/dashboard/support?error=${encodeURIComponent("订单不存在")}`);
    }
  }

  const ticketId = await createTicket({
    userId: user.id,
    subject,
    message,
    orderId,
  });

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  redirect(`/dashboard/support/${ticketId}?created=1`);
}

export async function replySupportTicketAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ticketId = text(formData, "ticketId");
  const message = text(formData, "message").slice(0, 4000);

  // 允许「只发图不写字」：客户拍张收款码直接发，比逼他打字更顺手。
  let imageHashes: string[] = [];
  try {
    imageHashes = await saveFormImages(formData);
  } catch (error) {
    redirect(
      `/dashboard/support/${ticketId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "图片上传失败",
      )}`,
    );
  }

  if (!ticketId || (!message && imageHashes.length === 0)) {
    redirect(`/dashboard/support/${ticketId}?error=${encodeURIComponent("请填写回复内容或上传图片")}`);
  }

  const owned = await query(
    "SELECT 1 FROM support_tickets WHERE id = $1 AND user_id = $2 LIMIT 1",
    [ticketId, user.id],
  );
  if (!owned.rows[0]) redirect("/dashboard/support");

  await addCustomerReply({ ticketId, userId: user.id, message, imageHashes });
  revalidatePath(`/dashboard/support/${ticketId}`);
  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  redirect(`/dashboard/support/${ticketId}?saved=1`);
}

export async function adminReplyTicketAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const ticketId = text(formData, "ticketId");
  const message = text(formData, "message").slice(0, 4000);

  let imageHashes: string[] = [];
  try {
    imageHashes = await saveFormImages(formData);
  } catch (error) {
    redirect(
      `/admin/support/${ticketId}?error=${encodeURIComponent(
        error instanceof Error ? error.message : "图片上传失败",
      )}`,
    );
  }

  if (!ticketId || (!message && imageHashes.length === 0)) {
    redirect(`/admin/support/${ticketId}?error=${encodeURIComponent("请填写回复内容或上传图片")}`);
  }

  await addAdminReply({ ticketId, message, imageHashes });
  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath("/admin/support");
  redirect(`/admin/support/${ticketId}?saved=1`);
}

export async function adminSetTicketStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const ticketId = text(formData, "ticketId");
  const status = text(formData, "status");

  if (ticketId && (status === "open" || status === "closed")) {
    await setTicketStatus(ticketId, status);
  }
  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath("/admin/support");
  redirect(`/admin/support/${ticketId}?status=${status}`);
}
