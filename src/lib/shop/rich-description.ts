import sanitizeHtml from "sanitize-html";
import { isAllowedHost, sanitizeSupplierCopy, type SupplierIdentity } from "./sanitize";

/**
 * Renders a supplier description as formatted article copy.
 *
 * Buyers should see the same structure the source page has: paragraphs,
 * emphasis, headings, tables and the red notice boxes. Only presentation is
 * copied. Supplier identity, external links and claims our own order flow
 * cannot honour are scrubbed, and every image must already be mirrored into
 * shop_images — an unmapped <img> is removed rather than hotlinked.
 */

const MAX_HTML_LENGTH = 80_000;

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "del",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "div", "span", "blockquote", "section", "article",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "figure", "figcaption", "img", "a", "hr", "small", "code", "pre",
];

const LENGTH = String.raw`-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|pt)?`;
const SPACED_LENGTHS = new RegExp(String.raw`^${LENGTH}(?:\s+${LENGTH}){0,3}$`, "i");
const COLOR = String.raw`(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)`;
const BORDER = new RegExp(
  String.raw`^(?:\d+(?:\.\d+)?px\s+(?:solid|dashed|dotted)\s+${COLOR}|none)$`,
  "i",
);

const ALLOWED_STYLES = {
  "*": {
    color: [new RegExp(String.raw`^(?:${COLOR}|[a-z]{3,20})$`, "i")],
    "background-color": [new RegExp(String.raw`^${COLOR}$`, "i")],
    background: [new RegExp(String.raw`^${COLOR}$`, "i")],
    border: [BORDER],
    "border-top": [BORDER],
    "border-right": [BORDER],
    "border-bottom": [BORDER],
    "border-left": [BORDER],
    "border-radius": [SPACED_LENGTHS],
    "box-shadow": [/^(?!.*url\()[0-9a-zA-Z#(),.%\s-]+$/i],
    margin: [SPACED_LENGTHS],
    "margin-top": [SPACED_LENGTHS],
    "margin-right": [SPACED_LENGTHS],
    "margin-bottom": [SPACED_LENGTHS],
    "margin-left": [SPACED_LENGTHS],
    padding: [SPACED_LENGTHS],
    "padding-top": [SPACED_LENGTHS],
    "padding-right": [SPACED_LENGTHS],
    "padding-bottom": [SPACED_LENGTHS],
    "padding-left": [SPACED_LENGTHS],
    "font-size": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i],
    "font-weight": [/^(?:normal|bold|[1-9]00)$/i],
    "line-height": [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/i],
    "letter-spacing": [/^-?\d+(?:\.\d+)?(?:px|em|rem)$/i],
    "text-align": [/^(?:left|center|right|justify)$/i],
    "text-decoration": [/^(?:none|underline|line-through)(?:\s+(?:solid|dashed|dotted))?$/i],
    "white-space": [/^(?:normal|pre-wrap|pre-line|nowrap)$/i],
    "vertical-align": [/^(?:top|middle|bottom|baseline)$/i],
    display: [/^(?:block|flex|grid|inline|inline-block|table|table-row|table-cell)$/i],
    overflow: [/^(?:hidden|auto|visible)$/i],
    "max-width": [new RegExp(String.raw`^(?:\d+(?:\.\d+)?(?:px|em|rem|%|vw)|auto|100%)$`, "i")],
    width: [new RegExp(String.raw`^(?:\d+(?:\.\d+)?(?:px|em|rem|%|vw)|auto|100%)$`, "i")],
    height: [new RegExp(String.raw`^(?:\d+(?:\.\d+)?(?:px|em|rem|%|vh)|auto)$`, "i")],
    opacity: [/^(?:0|1|0?\.\d+)$/],
  },
};

/**
 * Supplier settlement arithmetic (80/20 splits, card-platform fees, refund
 * coaching) lives in a nested notice block and is often split across
 * <strong> tags, so a text-node scrubber cannot see the whole sentence.
 * Remove any block whose combined text still carries those markers.
 */
const SUPPLIER_BLOCK_MARKERS = /(?:卡台手续费|退款话术|代申请服务|80\s*%\s*结算|20\s*%\s*为卡台)/;

function stripBlocksContaining(html: string, tag: "div" | "p"): string {
  let result = html;
  for (let round = 0; round < 20; round += 1) {
    const matches: Array<{ start: number; end: number }> = [];
    const openPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    let open: RegExpExecArray | null;
    while ((open = openPattern.exec(result))) {
      const start = open.index;
      const innerStart = openPattern.lastIndex;
      const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
      tokenPattern.lastIndex = innerStart;
      let depth = 1;
      let token: RegExpExecArray | null;
      while ((token = tokenPattern.exec(result))) {
        if (token[0].startsWith("</")) depth -= 1;
        else depth += 1;
        if (depth === 0) {
          const text = result.slice(innerStart, token.index).replace(/<[^>]+>/g, "");
          if (SUPPLIER_BLOCK_MARKERS.test(text)) {
            matches.push({ start, end: tokenPattern.lastIndex });
          }
          break;
        }
      }
    }
    if (matches.length === 0) break;
    // Remove the innermost matching block first; otherwise an ancestor whose
    // text happens to include the marker would take the whole article with it.
    const target = matches.reduce((inner, item) => (item.start > inner.start ? item : inner));
    result = result.slice(0, target.start) + result.slice(target.end);
  }
  return result;
}

const IMG_TAG_PATTERN = /<img\b[^>]*>/gi;
const IMG_SRC_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/i;
const HREF_ZYNANAI_HELP_PATTERN =
  /href\s*=\s*["'](?:https?:\/\/(?:[a-z0-9-]+\.)*zyanai\.cc)?\/user\/help\/(article\.\d+)[^"']*["']/gi;

function unescapeAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absoluteUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(unescapeAttribute(raw.trim()), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The only image URLs allowed in stored copy are our own mirrored paths. */
export function isMirroredImagePath(src: string): boolean {
  return /^\/api\/shop\/images\/[a-f0-9]{64}\.(?:png|jpe?g|webp|gif)$/.test(src);
}

/**
 * Claim and identity scrub for a text node. Kept close to scrubZyanaiCopy but
 * does not split on lines: inside HTML the same sentence can span several
 * tags, and removing a line would remove half a paragraph.
 */
function scrubTextNode(input: string, identities: SupplierIdentity[]): string {
  let text = sanitizeSupplierCopy(input);
  for (const identity of identities) text = sanitizeSupplierCopy(text, identity);
  text = text
    // Auto-delivery claims are already rewritten by sanitizeSupplierCopy
    // above; this only cleans HTML stored before that rule existed.
    .replace(/本商品为\s*CDK\s*人工发货\s*。?/g, "本商品为 CDK 卡密商品。")
    .replace(/100\s*%\s*(?:可用|有效|成功|稳定|靠谱)/gi, "可用")
    .replace(/永久\s*(?:可用|有效|使用)/gi, "长期可用")
    .replace(/%2B/gi, "+");
  return text;
}

function scrubAttribute(value: string, identities: SupplierIdentity[]): string {
  return scrubTextNode(value, identities).replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Rewrites every <img> to a mirrored path when one exists. Images whose URL is
 * not in the map are dropped: the public page must never load supplier assets.
 */
function rewriteImages(
  html: string,
  base: string,
  imageMap: Map<string, string>,
  identities: SupplierIdentity[],
): string {
  return html.replace(IMG_TAG_PATTERN, (tag) => {
    const match = tag.match(IMG_SRC_PATTERN);
    if (!match) return "";
    const raw = match[1] ?? "";
    if (isMirroredImagePath(raw)) {
      const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
      const safeAlt = alt ? scrubAttribute(unescapeAttribute(alt), identities) : "";
      return `<img src="${raw}" alt="${safeAlt.replace(/"/g, "&quot;")}" loading="lazy" decoding="async">`;
    }
    const resolved = absoluteUrl(raw, base);
    const mirrored = resolved ? imageMap.get(resolved) : null;
    if (!mirrored) return "";
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    const safeAlt = scrubAttribute(
      alt ? unescapeAttribute(alt) : "商品说明图片",
      identities,
    );
    return `<img src="${mirrored}" alt="${safeAlt.replace(/"/g, "&quot;")}" loading="lazy" decoding="async">`;
  });
}

function safeHref(raw: string, base: string): string | null {
  const value = unescapeAttribute(raw.trim());
  if (!value) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  if (value.startsWith("#")) return value;
  const resolved = absoluteUrl(value, base);
  if (!resolved) return null;
  try {
    const url = new URL(resolved);
    return isAllowedHost(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export type RichDescriptionOptions = {
  /** Original supplier URL -> /api/shop/images/<hash>.<ext>. */
  imageMap?: Map<string, string>;
  base?: string;
  identities?: SupplierIdentity[];
};

/**
 * Produces the stored, public-safe HTML for a product description.
 * Returns "" when nothing useful survives.
 */
export function buildRichDescriptionHtml(
  input: string,
  options: RichDescriptionOptions = {},
): string {
  if (!input || !input.trim()) return "";
  const base = options.base || "https://zyanai.cc";
  const identities = options.identities ?? [];
  const imageMap = options.imageMap ?? new Map<string, string>();

  let html = input.slice(0, MAX_HTML_LENGTH);
  html = html.replace(
    HREF_ZYNANAI_HELP_PATTERN,
    (_match, articleId: string) => `href="/help/${articleId}"`,
  );
  html = stripBlocksContaining(html, "div");
  html = stripBlocksContaining(html, "p");
  html = rewriteImages(html, base, imageMap, identities);

  const cleaned = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": ["style"],
      img: ["src", "alt", "loading", "decoding"],
      a: ["href", "rel"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https", "http"],
    allowedStyles: ALLOWED_STYLES,
    transformTags: {
      a: (tagName, attribs): { tagName: string; attribs: Record<string, string> } => {
        const href = attribs.href ? safeHref(attribs.href, base) : null;
        return href
          ? { tagName, attribs: { href, rel: "noopener noreferrer" } }
          : { tagName: "span", attribs: {} };
      },
      img: (tagName, attribs): { tagName: string; attribs: Record<string, string> } => {
        const src = attribs.src || "";
        if (!isMirroredImagePath(src)) return { tagName: "span", attribs: {} };
        return {
          tagName,
          attribs: {
            src,
            alt: scrubAttribute(attribs.alt || "", identities),
            loading: "lazy",
            decoding: "async",
          },
        };
      },
    },
    textFilter: (text) => {
      // Whitespace between inline tags carries word spacing; trimming it
      // would turn "hello <strong>world</strong>" into "helloworld".
      if (!text.trim()) return text;
      const leading = text.match(/^\s*/)?.[0] ?? "";
      const trailing = text.match(/\s*$/)?.[0] ?? "";
      const core = scrubTextNode(text, identities).trim();
      return core ? `${leading}${core}${trailing}` : "";
    },
  })
    .replace(/\s(?:style|class)=""/g, "")
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<div>\s*<\/div>/g, "")
    .trim();

  // A description must still contain words; an image-only shell is not useful.
  const textOnly = cleaned.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  return textOnly.length >= 20 ? cleaned : "";
}

/** Re-runs the safety pass on stored HTML before it reaches a public page. */
export function sanitizeStoredRichHtml(
  html: string,
  identities: SupplierIdentity[] = [],
): string {
  return buildRichDescriptionHtml(html, {
    base: "https://cokeai.cc.cd",
    identities,
  });
}
