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

function text(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
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

  if (!ticketId || !message) {
    redirect(`/dashboard/support/${ticketId}?error=${encodeURIComponent("请填写回复内容")}`);
  }

  const owned = await query(
    "SELECT 1 FROM support_tickets WHERE id = $1 AND user_id = $2 LIMIT 1",
    [ticketId, user.id],
  );
  if (!owned.rows[0]) redirect("/dashboard/support");

  await addCustomerReply({ ticketId, userId: user.id, message });
  revalidatePath(`/dashboard/support/${ticketId}`);
  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  redirect(`/dashboard/support/${ticketId}?saved=1`);
}

export async function adminReplyTicketAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const ticketId = text(formData, "ticketId");
  const message = text(formData, "message").slice(0, 4000);

  if (!ticketId || !message) {
    redirect(`/admin/support/${ticketId}?error=${encodeURIComponent("请填写回复内容")}`);
  }

  await addAdminReply({ ticketId, message });
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
