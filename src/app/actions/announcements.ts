"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import type { AnnouncementLevel } from "@/lib/announcement-types";

const PATH = "/admin/announcements";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function saved(): never {
  redirect(`${PATH}?saved=1`);
}

function text(value: FormDataEntryValue | null, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function level(value: FormDataEntryValue | null): AnnouncementLevel {
  const raw = String(value || "info");
  if (raw === "success" || raw === "warning") return raw;
  return "info";
}

function dateValue(value: FormDataEntryValue | null, field: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) fail(`${field}格式不正确`);
  return date.toISOString();
}

export async function createAnnouncementAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const title = text(formData.get("title"), 120);
  const body = text(formData.get("body"), 5_000);
  if (!title) fail("请填写公告标题");

  const startsAt = dateValue(formData.get("startsAt"), "开始时间");
  const endsAt = dateValue(formData.get("endsAt"), "结束时间");
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    fail("结束时间必须晚于开始时间");
  }

  await query(
    `INSERT INTO announcements
      (title, body, level, pinned, starts_at, ends_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      title,
      body,
      level(formData.get("level")),
      formData.get("pinned") === "on",
      startsAt,
      endsAt,
      admin.id,
    ],
  );
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath(PATH);
  saved();
}

export async function toggleAnnouncementAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) fail("缺少公告 ID");
  await query(
    `UPDATE announcements
        SET active = NOT active, updated_at = now()
      WHERE id = $1`,
    [id],
  );
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath(PATH);
  saved();
}

export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) fail("缺少公告 ID");
  await query("DELETE FROM announcements WHERE id = $1", [id]);
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath(PATH);
  saved();
}
