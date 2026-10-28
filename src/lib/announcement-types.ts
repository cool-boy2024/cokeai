export type AnnouncementLevel = "info" | "success" | "warning";

export function announcementLevelLabel(level: AnnouncementLevel): string {
  if (level === "success") return "更新";
  if (level === "warning") return "注意";
  return "公告";
}
