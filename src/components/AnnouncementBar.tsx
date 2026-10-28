import { listActiveAnnouncements } from "@/lib/announcements";
import { AnnouncementStrip } from "./AnnouncementStrip";

export async function AnnouncementBar() {
  const items = await listActiveAnnouncements(5).catch(() => []);
  if (items.length === 0) return null;

  return (
    <AnnouncementStrip
      items={items.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        level: item.level,
        updated_at: item.updated_at,
      }))}
    />
  );
}
