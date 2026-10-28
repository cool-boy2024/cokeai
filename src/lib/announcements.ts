import { query } from "@/lib/db";
import type { AnnouncementLevel } from "@/lib/announcement-types";

export type { AnnouncementLevel } from "@/lib/announcement-types";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminAnnouncement = Announcement & {
  active: boolean;
};

const PUBLIC_COLUMNS = `
  id, title, body, level, pinned, starts_at, ends_at, created_at, updated_at
`;

function hydrate<T extends Announcement>(row: T): T {
  return { ...row, pinned: Boolean(row.pinned) };
}

export async function listActiveAnnouncements(limit = 20): Promise<Announcement[]> {
  const result = await query<Announcement>(
    `SELECT ${PUBLIC_COLUMNS}
       FROM announcements
      WHERE active = TRUE
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at > now())
      ORDER BY pinned DESC, starts_at DESC NULLS LAST, created_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(hydrate);
}

export async function listAllAnnouncements(): Promise<AdminAnnouncement[]> {
  const result = await query<AdminAnnouncement>(
    `SELECT ${PUBLIC_COLUMNS}, active
       FROM announcements
      ORDER BY active DESC, pinned DESC, created_at DESC
      LIMIT 200`,
  );
  return result.rows.map((row) => ({
    ...hydrate(row),
    active: Boolean(row.active),
  }));
}
