import sanitizeHtml from "sanitize-html";
import { query } from "@/lib/db";
import { isAllowedHost, sanitizeSupplierCopy } from "@/lib/shop/sanitize";

/**
 * Read-time scrubber for mirrored help content.
 *
 * The help centre is copied from a supplier site. Sync-time sanitising keeps
 * scripts out, but it deliberately rewrites relative links and media to the
 * supplier's absolute URLs, and article titles/summaries are stored verbatim.
 * Public reads therefore re-check every field: links and media pointing at a
 * non-official host are removed, and supplier domains/names in text are
 * replaced. Admin reads stay raw for support work.
 */
const HELP_ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s",
  "blockquote", "code", "pre", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "a", "img", "video", "source", "figure", "figcaption",
  "span", "div", "small", "sub", "sup",
];

function isSafeHelpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // First-party paths and in-page anchors are always fine.
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
  if (/^(?:mailto:|tel:)/i.test(trimmed)) return true;
  if (/^data:image\//i.test(trimmed)) return true;
  if (trimmed.startsWith("//")) return false;
  try {
    return isAllowedHost(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

// sanitize-html does not expose a player's child tags to exclusiveFilter, so a
// <video> whose URL lives in its <source> child looks empty and gets dropped.
// Copy the first mirrored <source> up onto the <video> itself first; the same
// pass unwraps a link around the player so clicking it never leaves the site.
function promoteVideoSources(html: string): string {
  const withSrc = html.replace(
    /<video\b([^>]*)>([\s\S]*?)<\/video>/gi,
    (whole, attrs: string, inner: string) => {
      if (/\bsrc\s*=/i.test(attrs)) return whole;
      const source = /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(inner);
      if (!source) return whole;
      return `<video${attrs} src="${source[1]}"></video>`;
    },
  );
  return withSrc.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, attrs: string, inner: string) => {
      if (!/<video\b/i.test(inner)) return whole;
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      // Keep the player and its label, drop the file link they were wrapped
      // in so pressing play can never navigate away from the article.
      return /\.(?:mp4|webm)(?:[?#]|$)/i.test(href) ? inner : whole;
    },
  );
}

function sanitizeHelpHtml(html: string): string {
  if (!html) return "";
  const parsed = sanitizeHtml(promoteVideoSources(html), {
    allowedTags: HELP_ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      video: ["src", "poster", "controls", "playsinline", "preload", "width", "height"],
      source: ["src", "type"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      video: ["http", "https"],
      source: ["http", "https"],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => {
        const next = { ...attribs };
        if (next.href && !isSafeHelpUrl(next.href)) delete next.href;
        return {
          tagName: "a",
          attribs: {
            ...next,
            rel: "noopener noreferrer nofollow",
            ...(next.href?.startsWith("/") ? {} : { target: "_blank" }),
          },
        };
      },
      img: (_tagName, attribs) => {
        const next = { ...attribs };
        if (next.src && !isSafeHelpUrl(next.src)) delete next.src;
        return { tagName: "img", attribs: next };
      },
      video: (_tagName, attribs) => {
        const next = { ...attribs };
        if (next.src && !isSafeHelpUrl(next.src)) delete next.src;
        if (next.poster && !isSafeHelpUrl(next.poster)) delete next.poster;
        return { tagName: "video", attribs: next };
      },
      source: (_tagName, attribs) => {
        const next = { ...attribs };
        if (next.src && !isSafeHelpUrl(next.src)) delete next.src;
        return { tagName: "source", attribs: next };
      },
    },
    exclusiveFilter: (frame) =>
      (frame.tag === "img" && !frame.attribs.src) ||
      // promoteVideoSources() has already moved the mirrored URL onto the
      // player, so a <video> without src really has no playable source.
      (frame.tag === "video" && !frame.attribs.src) ||
      (frame.tag === "source" && !frame.attribs.src),
  });
  return sanitizeSupplierCopy(parsed);
}

function cleanHelpText(value: string): string {
  return sanitizeSupplierCopy(value || "");
}

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
    title: cleanHelpText(row.title),
    summary: cleanHelpText(row.summary),
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
    title: cleanHelpText(row.title),
    summary: cleanHelpText(row.summary),
    bodyHtml: sanitizeHelpHtml(row.body_html),
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    sortOrder: row.sort_order,
    syncedAt: row.synced_at,
  };
}

/**
 * Resolves the small set of articles linked from a shop product. Keeps the
 * caller's order (product-defined priority) and silently drops ids that are
 * missing or hidden from the public help center.
 */
export async function getVisibleHelpArticlesByIds(
  ids: string[],
): Promise<{ id: string; title: string }[]> {
  if (ids.length === 0) return [];
  const result = await query<{ id: string; title: string }>(
    `SELECT id, title
       FROM help_articles
      WHERE visible = TRUE AND id = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, title: cleanHelpText(row.title) }] : [];
  });
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
