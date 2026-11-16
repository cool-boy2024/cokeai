import { query } from "./db";
import { VISITOR_RETENTION_DAYS } from "./visits-format";

export type VisitRange = 1 | 7 | 30;

const BOUNDS_CTE = `
  WITH bounds AS (
    SELECT CASE
             WHEN $1 = 1 THEN date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
             WHEN $1 = 7 THEN (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') - INTERVAL '6 days'
             ELSE (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days'
           END AS start
  )
`;

export type VisitorOverview = {
  visitors: number;
  linked: number;
  signups: number;
  conversionPct: number;
};

export type TopReferrer = { referrer: string; count: number };

export type RecentSignup = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  ip: string;
  referrer: string;
  landing_path: string;
  user_agent: string;
  country: string;
  region: string;
  city: string;
};

export type AnonymousVisitor = {
  visitor_id: string;
  created_at: string;
  ip: string;
  user_agent: string;
  referrer: string;
  landing_path: string;
  country: string;
  region: string;
  city: string;
};

export async function recordFirstVisit(input: {
  visitorId: string;
  ip: string;
  userAgent: string;
  referrer: string;
  landingPath: string;
  country: string;
  region: string;
  city: string;
}): Promise<void> {
  await query(
    `INSERT INTO site_visits
       (visitor_id, ip, user_agent, referrer, landing_path, country, region, city)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (visitor_id) DO NOTHING`,
    [
      input.visitorId,
      input.ip,
      input.userAgent,
      input.referrer,
      input.landingPath,
      input.country,
      input.region,
      input.city,
    ],
  );
}

export async function linkVisitorToUser(userId: string, visitorId: string): Promise<void> {
  await query(
    "UPDATE site_visits SET user_id = $1 WHERE visitor_id = $2 AND user_id IS NULL",
    [userId, visitorId],
  );
}

export async function purgeSiteVisits(): Promise<void> {
  await query(
    "DELETE FROM site_visits WHERE created_at < now() - make_interval(days => $1)",
    [VISITOR_RETENTION_DAYS],
  );
}

export async function getVisitorOverview(rangeDays: VisitRange): Promise<VisitorOverview> {
  const { rows } = await query<{ visitors: number; linked: number; signups: number }>(
    `${BOUNDS_CTE}
     SELECT
       (SELECT COUNT(*) FROM site_visits, bounds WHERE created_at >= bounds.start)::int AS visitors,
       (SELECT COUNT(*) FROM site_visits, bounds WHERE created_at >= bounds.start AND user_id IS NOT NULL)::int AS linked,
       (SELECT COUNT(*) FROM users, bounds WHERE created_at >= bounds.start AND role <> 'admin')::int AS signups
    `,
    [rangeDays],
  );
  const row = rows[0] || { visitors: 0, linked: 0, signups: 0 };
  return {
    visitors: Number(row.visitors) || 0,
    linked: Number(row.linked) || 0,
    signups: Number(row.signups) || 0,
    conversionPct: row.visitors ? Math.round((row.linked / row.visitors) * 100) : 0,
  };
}

export async function listTopReferrers(
  rangeDays: VisitRange,
  limit = 8,
): Promise<TopReferrer[]> {
  const { rows } = await query<{ referrer: string; count: number }>(
    `${BOUNDS_CTE}
     SELECT referrer, COUNT(*)::int AS count
       FROM site_visits, bounds
      WHERE created_at >= bounds.start
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT $2`,
    [rangeDays, limit],
  );
  return rows.map((row) => ({ referrer: row.referrer, count: Number(row.count) }));
}

export async function listRecentSignups(
  rangeDays: VisitRange,
  limit = 200,
): Promise<RecentSignup[]> {
  const { rows } = await query<RecentSignup>(
    `${BOUNDS_CTE}
     SELECT u.id, u.email, u.name, u.created_at,
            COALESCE(NULLIF(v.ip, ''), NULLIF(s.ip, ''), '') AS ip,
            COALESCE(v.referrer, '') AS referrer,
            COALESCE(v.landing_path, '') AS landing_path,
            COALESCE(NULLIF(v.user_agent, ''), NULLIF(s.user_agent, ''), '') AS user_agent,
            COALESCE(v.country, '') AS country,
            COALESCE(v.region, '') AS region,
            COALESCE(v.city, '') AS city
       FROM users u
       LEFT JOIN LATERAL (
         SELECT ip, referrer, landing_path, user_agent, country, region, city
           FROM site_visits
          WHERE user_id = u.id
          ORDER BY created_at ASC
          LIMIT 1
       ) v ON TRUE
       LEFT JOIN LATERAL (
         SELECT ip, user_agent
           FROM sessions
          WHERE user_id = u.id
          ORDER BY created_at ASC
          LIMIT 1
       ) s ON TRUE
      WHERE u.created_at >= (SELECT start FROM bounds)
        AND u.role <> 'admin'
      ORDER BY u.created_at DESC
      LIMIT $2`,
    [rangeDays, limit],
  );
  return rows;
}

export async function listAnonymousVisitors(
  rangeDays: VisitRange,
  limit = 200,
): Promise<AnonymousVisitor[]> {
  const { rows } = await query<AnonymousVisitor>(
    `${BOUNDS_CTE}
     SELECT visitor_id, created_at, ip, user_agent, referrer, landing_path,
            country, region, city
       FROM site_visits, bounds
      WHERE created_at >= bounds.start
        AND user_id IS NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [rangeDays, limit],
  );
  return rows;
}

export async function countNewSignups24h(): Promise<number> {
  const { rows } = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE role <> 'admin'
        AND created_at >= now() - INTERVAL '24 hours'`,
  );
  return Number(rows[0]?.count) || 0;
}
