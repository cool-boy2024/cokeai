import { query } from "@/lib/db";

export type HelpArticleSummary = {
  id: string;
  title: string;
  summary: string;
  publishedAt: Date | null;
  sortOrder: number;
};

export type HelpArticle = HelpArticleSummary & {
  bodyHtml: string;
  sourceUrl: string;
  syncedAt: Date;
};

export type HelpSyncStats = {
  total: number;
  visible: number;
  hidden: number;
  lastSyncedAt: Date | null;
};

type ArticleRow = {
  id: string;
  title: string;
  summary: string;
  published_at: Date | null;
  sort_order: number;
};

export async function listHelpArticles(): Promise<HelpArticleSummary[]> {
  const result = await query<ArticleRow>(
    `SELECT id, title, summary, published_at, sort_order
       FROM help_articles
      WHERE visible
      ORDER BY sort_order ASC, published_at DESC NULLS LAST, title ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    sortOrder: row.sort_order,
  }));
}

export async function getHelpArticle(id: string): Promise<HelpArticle | null> {
  const result = await query<ArticleRow & {
    body_html: string;
    source_url: string;
    synced_at: Date;
  }>(
    `SELECT id, title, summary, body_html, source_url, published_at, sort_order, synced_at
       FROM help_articles
      WHERE id = $1 AND visible
      LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    bodyHtml: row.body_html,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    sortOrder: row.sort_order,
    syncedAt: row.synced_at,
  };
}

export async function getHelpSyncStats(): Promise<HelpSyncStats> {
  const result = await query<{
    total: string;
    visible: string;
    last_synced_at: Date | null;
  }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE visible)::text AS visible,
            MAX(synced_at) AS last_synced_at
       FROM help_articles`,
  );
  const row = result.rows[0];
  const total = Number(row?.total || 0);
  const visible = Number(row?.visible || 0);
  return {
    total,
    visible,
    hidden: Math.max(0, total - visible),
    lastSyncedAt: row?.last_synced_at ?? null,
  };
}

export type HelpArticleAdminRow = HelpArticleSummary & {
  visible: boolean;
  syncedAt: Date;
};

export async function listHelpArticlesForAdmin(): Promise<HelpArticleAdminRow[]> {
  const result = await query<ArticleRow & { visible: boolean; synced_at: Date }>(
    `SELECT id, title, summary, published_at, sort_order, visible, synced_at
       FROM help_articles
      ORDER BY visible DESC, sort_order ASC, published_at DESC NULLS LAST, title ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    sortOrder: row.sort_order,
    visible: row.visible,
    syncedAt: row.synced_at,
  }));
}
