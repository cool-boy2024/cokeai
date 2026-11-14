import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { query } from "@/lib/db";

/**
 * Mirrors the supplier's public help center into help_articles.
 *
 * The index lists every article with its id, title, summary and date; each
 * article page holds the body inside `.help-article-content`. Bodies are
 * sanitised here (scripts, styles, frames, inline handlers removed) and all
 * relative media/links are rewritten to absolute URLs, because images and
 * videos live on CDNs that allow hotlinking. Hidden articles are kept in the
 * table with visible = false so a failed fetch never erases content.
 */

const BASE_URL = "https://zyanai.cc";
const INDEX_URL = `${BASE_URL}/user/help/index`;
const FETCH_TIMEOUT_MS = 20_000;
const BETWEEN_FETCHES_MS = 250;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 CokeAIHelpSync/1.0";

export type HelpSyncResult = {
  ok: boolean;
  added: number;
  updated: number;
  unchanged: number;
  hidden: number;
  checked: number;
  errors: string[];
  syncedAt: string;
};

type IndexEntry = {
  id: string;
  title: string;
  summary: string;
  publishedAt: Date | null;
  sortOrder: number;
};

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${url} 返回 HTTP ${response.status}`);
  }
  return response.text();
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ldquo: "「",
    rdquo: "」",
    hellip: "…",
    mdash: "—",
  };
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseIndex(html: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const chunks = html.split(/<article[^>]*class="[^"]*help-article-row[^"]*"[^>]*>/i).slice(1);
  chunks.forEach((chunk, index) => {
    const body = chunk.split(/<\/article>/i)[0] ?? chunk;
    const link = body.match(/href="\/user\/help\/article\.(\d+)"/i);
    if (!link) return;
    const id = `article.${link[1]}`;
    const titleMatch =
      body.match(/<div[^>]*class="[^"]*help-article-title-line[^"]*"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
      body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const summaryMatch = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const timeMatch = body.match(/<time[^>]*>([\s\S]*?)<\/time>/i);
    const title = titleMatch ? textOf(titleMatch[1]) : "";
    if (!title) return;
    let publishedAt: Date | null = null;
    if (timeMatch) {
      const raw = textOf(timeMatch[1]);
      // The source prints Beijing time without a zone: 2026-11-13 01:23:53
      const parsed = new Date(`${raw.replace(" ", "T")}+08:00`);
      if (!Number.isNaN(parsed.getTime())) publishedAt = parsed;
    }
    entries.push({
      id,
      title,
      summary: summaryMatch ? textOf(summaryMatch[1]) : "",
      publishedAt,
      sortOrder: entries.length || index,
    });
  });
  // De-duplicate by id, keeping the first occurrence from the index order.
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Returns the inner HTML of the first element whose class contains `name`. */
function extractContainer(html: string, name: string): string | null {
  const open = new RegExp(`<div[^>]*class="[^"]*${name}[^"]*"[^>]*>`, "i");
  const match = open.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  const tag = /<div\b|<\/div>/gi;
  tag.lastIndex = start;
  let depth = 1;
  let hit: RegExpExecArray | null;
  while ((hit = tag.exec(html))) {
    if (hit[0].toLowerCase() === "</div>") {
      depth -= 1;
      if (depth === 0) return html.slice(start, hit.index);
    } else {
      depth += 1;
    }
  }
  return null;
}

function absolutize(html: string): string {
  const rewrite = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return value;
    // The supplier's TOTP helper is mirrored as our own page, so tutorial
    // links keep readers on this site instead of sending them to zyanai.cc.
    if (
      trimmed === "/2FA.html" ||
      /^https?:\/\/(?:www\.)?zyanai\.cc\/2FA\.html\/?$/i.test(trimmed)
    ) {
      return "/tools/2fa";
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("blob:")
    ) {
      return value;
    }
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return `${BASE_URL}${trimmed}`;
    if (/^https?:/i.test(trimmed)) return trimmed;
    return `${BASE_URL}/${trimmed.replace(/^\.\//, "")}`;
  };

  return html
    .replace(
      /\b(src|href|poster|data-src)=("|')([^"']*)\2/gi,
      (_match, attr: string, quote: string, value: string) =>
        `${attr}=${quote}${rewrite(value)}${quote}`,
    )
    .replace(/url\((\s*['"]?)([^'")]+)\1\)/gi, (_match, _q, value: string) =>
      `url("${rewrite(value)}")`,
    );
}

function isSafeHelpUrl(value: string): boolean {
  return /^(?:https?:\/\/|mailto:|tel:|#|data:image\/)/i.test(value.trim());
}

const HELP_ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s",
  "blockquote", "code", "pre", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "a", "img", "video", "source", "figure", "figcaption",
  "span", "div", "small", "sub", "sup",
];

function sanitize(html: string): string {
  // absolutize() runs first so links and media keep working; the allow-list
  // parser then removes every tag, attribute and URL scheme that is not
  // explicitly permitted. Regex stripping was bypassable (for example
  // `<img/src=x/onerror=...>`), so the mirrored body must go through a real
  // HTML parser.
  return sanitizeHtml(absolutize(html), {
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
        return {
          tagName: "video",
          attribs: {
            ...next,
            controls: "controls",
            playsinline: "playsinline",
            preload: next.preload || "metadata",
          },
        };
      },
      source: (_tagName, attribs) => {
        const next = { ...attribs };
        if (next.src && !isSafeHelpUrl(next.src)) delete next.src;
        return { tagName: "source", attribs: next };
      },
    },
  }).trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncHelpArticles(): Promise<HelpSyncResult> {
  const errors: string[] = [];
  const result: HelpSyncResult = {
    ok: false,
    added: 0,
    updated: 0,
    unchanged: 0,
    hidden: 0,
    checked: 0,
    errors,
    syncedAt: new Date().toISOString(),
  };

  let indexHtml: string;
  try {
    indexHtml = await fetchPage(INDEX_URL);
  } catch (error) {
    errors.push(
      `获取帮助中心列表失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
    return result;
  }

  const entries = parseIndex(indexHtml);
  if (entries.length === 0) {
    errors.push("帮助中心列表解析为空，已保留现有文章");
    return result;
  }

  const existing = await query<{ id: string; content_hash: string; visible: boolean }>(
    "SELECT id, content_hash, visible FROM help_articles",
  );
  const existingMap = new Map(existing.rows.map((row) => [row.id, row]));

  for (const entry of entries) {
    const url = `${BASE_URL}/user/help/${entry.id}`;
    let html: string;
    try {
      html = await fetchPage(url);
    } catch (error) {
      errors.push(
        `${entry.title}：${error instanceof Error ? error.message : "抓取失败"}`,
      );
      continue;
    }
    const rawBody = extractContainer(html, "help-article-content") ?? "";
    const bodyHtml = sanitize(rawBody);
    if (!bodyHtml) {
      errors.push(`${entry.title}：正文为空，已跳过`);
      continue;
    }
    if (bodyHtml.length > 600_000) {
      errors.push(`${entry.title}：正文超过 600 KB，已跳过`);
      continue;
    }

    const hash = sha256(`${entry.title}\n${entry.summary}\n${bodyHtml}`);
    const previous = existingMap.get(entry.id);

    await query(
      `INSERT INTO help_articles
         (id, title, summary, body_html, source_url, published_at, content_hash,
          sort_order, visible, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, now())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         body_html = EXCLUDED.body_html,
         source_url = EXCLUDED.source_url,
         published_at = EXCLUDED.published_at,
         content_hash = EXCLUDED.content_hash,
         sort_order = EXCLUDED.sort_order,
         visible = TRUE,
         synced_at = now()`,
      [
        entry.id,
        entry.title,
        entry.summary,
        bodyHtml,
        url,
        entry.publishedAt,
        hash,
        entry.sortOrder,
      ],
    );

    result.checked += 1;
    if (!previous) result.added += 1;
    else if (previous.content_hash !== hash || !previous.visible) result.updated += 1;
    else result.unchanged += 1;

    await sleep(BETWEEN_FETCHES_MS);
  }

  // Articles that disappeared from the index are hidden, never deleted.
  const liveIds = new Set(entries.map((entry) => entry.id));
  const stale = existing.rows.filter((row) => !liveIds.has(row.id) && row.visible);
  if (stale.length > 0) {
    await query("UPDATE help_articles SET visible = FALSE WHERE id = ANY($1::text[])", [
      stale.map((row) => row.id),
    ]);
    result.hidden = stale.length;
  }

  result.ok = errors.length === 0;
  return result;
}
