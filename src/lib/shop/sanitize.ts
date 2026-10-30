/**
 * Buyer-facing copy may be lifted from supplier pages, but it must never show
 * where we source it. Store names, supplier domains, contact handles and
 * external links are replaced with CokeAI's own wording. The actual product
 * rules are kept; only the identity around them changes.
 */
export const SHOP_COPY_NAME = "CokeAI 小店";
const SHOP_COPY_URL = "https://cokeai.cc.cd/shop";
const SUPPLIER_PLACEHOLDER = "本站商品页";

// Official product sites are part of the usage instructions, not supplier
// identity. Everything else is treated as an external shop and masked.
const OFFICIAL_HOSTS = [
  "openai.com",
  "chatgpt.com",
  "claude.ai",
  "anthropic.com",
  "google.com",
  "gemini.google.com",
  "grok.com",
  "x.ai",
  "apple.com",
  "microsoft.com",
  "muse.ai",
];

function isAllowedHost(host: string): boolean {
  const clean = host.toLowerCase().replace(/^www\./, "");
  if (clean === "cokeai.cc.cd" || clean.endsWith(".cokeai.cc.cd")) return true;
  return OFFICIAL_HOSTS.some((allowed) => clean === allowed || clean.endsWith(`.${allowed}`));
}

function hostFromValue(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

export type SupplierIdentity = {
  store?: string | null;
  url?: string | null;
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function storeNames(store: string | null | undefined): string[] {
  const full = (store || "").trim();
  if (!full) return [];
  const names = new Set<string>([full]);
  for (const part of full.split(/[\/|·,，、]+/)) {
    const name = part.trim();
    // Keep short tokens such as a bare region; replacing those would mangle
    // legitimate product copy.
    if (name.length >= 4) names.add(name);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/**
 * Removes supplier identity from a block of text. Safe to call on already
 * clean copy: the shop's own name and URL are left untouched.
 */
export function sanitizeSupplierCopy(
  input: string,
  identity: SupplierIdentity = {},
): string {
  if (!input) return "";

  let text = input;

  // Exact store names first, before generic phrase replacement.
  for (const name of storeNames(identity.store)) {
    text = text.replace(new RegExp(escapeRegExp(name), "gi"), SHOP_COPY_NAME);
  }

  // Supplier host in any form, including its bare domain.
  const host = hostOf(identity.url);
  if (host) {
    text = text.replace(
      new RegExp(
        `https?://(?:[a-z0-9-]+\\.)*${escapeRegExp(host)}(?::\\d+)?(?:/[^\\s，。；、）)】\\]\"'<>]*)?`,
        "gi",
      ),
      SUPPLIER_PLACEHOLDER,
    );
    text = text.replace(
      new RegExp(`(?:[a-z0-9-]+\\.)*${escapeRegExp(host)}(?::\\d+)?(?:/[^\\s，。；、）)】\\]\"'<>]*)?`, "gi"),
      SUPPLIER_PLACEHOLDER,
    );
  }

  // Any other external URL would also point buyers away from the shop. Keep
  // official product sites so the usage steps still work.
  text = text.replace(
    /https?:\/\/[^\s，。；、）)】\]"'<>]+/gi,
    (url) => {
      const urlHost = hostFromValue(url);
      return urlHost && isAllowedHost(urlHost) ? url : SUPPLIER_PLACEHOLDER;
    },
  );
  text = text.replace(
    /(?<![\w.@])(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|cn|net|org|io|cc|top|xyz|vip|shop|me|co)(?:\/[^\s，。；、）)】\]"'<>]*)?/gi,
    (value) => {
      const urlHost = hostFromValue(value);
      return urlHost && isAllowedHost(urlHost) ? value : SUPPLIER_PLACEHOLDER;
    },
  );

  // Contact handles and mailboxes.
  text = text.replace(
    /((?:微信|VX|vx|QQ|qq|Telegram|TG|电报|WhatsApp|whatsapp)\s*(?:号|账号|ID|id|群)?\s*[:：]?\s*)([A-Za-z0-9_+@.\-]{4,})/g,
    "本店客服",
  );
  text = text.replace(
    /((?:客服|联系)\s*(?:QQ|微信|电话|群)?\s*[:：]\s*)([A-Za-z0-9_+\-]{4,})/g,
    "$1本店客服",
  );
  text = text.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "本店客服",
  );

  // Sourcing vocabulary. Longest phrases first so we do not produce
  // "本店本店".
  text = text
    .replace(/按货源说明/g, "按商品说明")
    .replace(/货源教程/g, "商品页教程")
    .replace(/货源原文/g, "商品说明")
    .replace(/货源店铺|货源方|供货商|上游供应商/g, "本店")
    .replace(/货源/g, "本店")
    .replace(/本店本店/g, "本店");

  // Keep the placeholder useful in prose and avoid leftovers.
  text = text
    .replace(new RegExp(SUPPLIER_PLACEHOLDER, "g"), "本站商品页")
    .replace(/本店客服客服/g, "本店客服")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // If a line was only supplier contact details, replace it with our own shop
  // pointer instead of leaving an empty bullet.
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // A masked link is not useful on its own; point to the tutorial that is
      // embedded lower on the same product page.
      if (trimmed.includes(SUPPLIER_PLACEHOLDER)) {
        if (trimmed.includes("视频教程")) {
          return trimmed.replaceAll(SUPPLIER_PLACEHOLDER, "本页下方视频教程");
        }
        if (trimmed.includes("教程")) {
          return trimmed.replaceAll(SUPPLIER_PLACEHOLDER, "本页教程");
        }
      }
      return trimmed;
    })
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeSupplierLines(
  lines: string[],
  identity: SupplierIdentity = {},
): string[] {
  return lines
    .map((line) => sanitizeSupplierCopy(line, identity))
    .filter((line) => line.length > 0);
}

/** Public URL of our own shop, used when a supplier link must be replaced. */
export function shopCopyUrl(): string {
  return SHOP_COPY_URL;
}
