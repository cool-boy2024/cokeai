import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "运营后台" };
export const dynamic = "force-dynamic";

/**
 * The old overview counted API recharge orders, which are no longer sold.
 * Operators land on the shop workbench instead; the legacy pages keep their
 * own URLs so a rollback can still reach them directly.
 */
export default async function AdminIndexPage() {
  await requireAdmin();
  redirect("/admin/shop");
}
