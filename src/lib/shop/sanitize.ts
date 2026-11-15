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

export function isAllowedHost(host: string): boolean {
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

/**
 * Shop brands that show up inside aggregated-feed copy even when the offer's
 * `source_store` says something else (a marketplace entry named after a city
 * whose notice introduces the real shop, for example). Scrubbing only the
 * store name left these on paid product pages, so keep a static list.
 * Ordered longest-first so a brand and its tagline are replaced together.
 */
const SUPPLIER_BRAND_NAMES = [
  "AI补给站·真低价",
  "AI补给站",
  "子砚的AI店铺",
  "子砚",
  "启航AI",
  "AI小店",
  "RedeemGPT",
  "zyanai",
  "wzyp",
  "aibuji",
  "aibijia",
  "lovecodex",
  "ldxp",
  "kapay",
  "beibei",
  "aisou",
  "talkai",
];

/** Marketing phrases tied to a supplier shop front, not to the product. */
const SUPPLIER_STORE_PHRASES: Array<[RegExp, string]> = [
  [/真低价/g, "价格透明"],
  [/站长本店客服/g, "本站客服"],
  [/站长/g, "本站"],
];

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
 * This shop fulfils every order by hand, including offers imported from
 * suppliers that advertise 自动发货. Those promises cannot be kept, so buyer
 * copy is rewritten to describe the flow the buyer will actually see.
 *
 * Longest phrases first: a blanket 自动发货 -> 人工发货 substitution first
 * would leave a 24-hour delivery promise in place and turn the supplier's
 * delivery-method legend into nonsense.
 */
export function sanitizeFulfillmentCopy(input: string): string {
  if (!input) return "";
  return input
    .replace(
      /标注\s*[“"「]?\s*自动发货\s*[”"」]?\s*的会系统秒发\s*[，,；;]\s*标注\s*[“"「]?\s*在线发货\s*[”"」]?\s*的会人工处理发货\s*[；;。]?/g,
      "本站商品均为人工发货，付款后由客服按顺序处理；",
    )
    .replace(
      /(?:标注\s*[“"「]?\s*自动发货\s*[”"」]?\s*的会系统秒发|标注\s*[“"「]?\s*在线发货\s*[”"」]?\s*的会人工处理发货)\s*[；;。]?/g,
      "本站商品均为人工发货；",
    )
    .replace(/下单自动发\s*CDK\s*[，,]\s*不用等待人工发货/g, "下单后人工发货，卡密会显示在订单详情页")
    .replace(/下单自动发/g, "下单后人工发")
    .replace(
      /下单付款后\s*[，,]?\s*系统会自动显示充值卡密\s*。?/g,
      "付款后由本店人工完成采购，卡密会显示在你的订单详情页。",
    )
    .replace(/系统会自动显示充值卡密/g, "卡密会显示在你的订单详情页")
    .replace(
      /本商品为\s*CDK\s*自动发货\s*([。，,])?/g,
      (_match, punct: string | undefined) =>
        `本商品为 CDK 卡密商品${punct && punct !== "。" ? punct : "。"}`,
    )
    .replace(/(?:购买后|付款后|下单后|下单)\s*自动发货/g, "下单后人工发货")
    .replace(/\d{1,2}\s*(?:小时|h|H)\s*内?\s*自动发货/g, "下单后人工发货")
    .replace(/自动发货查收说明/g, "发货与查收说明")
    .replace(/自动发货/g, "人工发货")
    .replace(/自动发卡/g, "人工发卡");
}

/**
 * Removes supplier identity from a block of text. Safe to call on already
 * clean copy: the shop's own name and URL are left untouched.
 */
/**
 * Supplier settlement arithmetic is not product information: 80/20 refund
 * splits, card-platform fees and refund coaching tell the buyer how much the
 * upstream shop keeps. Rich HTML removes whole blocks containing these
 * markers, but the same sentences also arrive as plain description and refund
 * copy, so drop the matching sentence from every public text field.
 */
const SETTLEMENT_MARKER =
  /(?:卡台手续费|退款话术|代申请服务|80\s*%\s*结算|20\s*%\s*为卡台|按.{0,12}官方退款.{0,16}结算)/;

function stripSettlementCopy(input: string): string {
  if (!input || !SETTLEMENT_MARKER.test(input)) return input;
  return input
    .split("\n")
    .map((line) => {
      if (!SETTLEMENT_MARKER.test(line)) return line;
      return line
        .split(/(?<=[。！？!?；;])/)
        .filter((sentence) => !SETTLEMENT_MARKER.test(sentence))
        .join("")
        .trim();
    })
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n");
}

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
    /(?<![\w.@])(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|cn|net|org|cloud|club|online|store|site|info|link|live|shop|app|dev|pro|biz|top|xyz|vip|fun|io|cc|co|ai|me|tv|us|uk|hk|tw|jp|kr|sg)(?:\/[^\s，。；、）)】\]"'<>]*)?/gi,
    (value, offset: number, whole: string) => {
      const urlHost = hostFromValue(value);
      if (urlHost && isAllowedHost(urlHost)) return value;
      // A TLD in the pattern list can be the first half of our own domain
      // (cokeai.cc.cd): masking "cokeai.cc" here would leave ".cd" behind and
      // turn the announcement's 长期网址 into nonsense. If the following
      // labels complete an allowed host, leave the whole host untouched.
      const continuation = whole.slice(offset + value.length).match(/^\.[a-z0-9-]+/i)?.[0];
      const extendedHost = continuation ? hostFromValue(`${value}${continuation}`) : null;
      if (extendedHost && isAllowedHost(extendedHost)) return value;
      return SUPPLIER_PLACEHOLDER;
    },
  );

  // Known shop brands and their taglines, regardless of the offer's store
  // field. Runs after the URL pass so a brand that is also a domain
  // ("zyanai.cc") is masked as a link instead of leaving "CokeAI 小店.cc".
  for (const name of SUPPLIER_BRAND_NAMES) {
    text = text.replace(new RegExp(escapeRegExp(name), "gi"), SHOP_COPY_NAME);
  }
  for (const [pattern, replacement] of SUPPLIER_STORE_PHRASES) {
    text = text.replace(pattern, replacement);
  }

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

  // Every order is fulfilled by hand; supplier auto-delivery wording is
  // replaced with the flow buyers actually get.
  text = sanitizeFulfillmentCopy(text);

  // Sourcing vocabulary. Longest phrases first so we do not produce
  // "本店本店".
  text = text
    .replace(/按货源说明/g, "按商品说明")
    .replace(/货源教程/g, "商品页教程")
    .replace(/货源原文/g, "商品说明")
    // A shop cannot sensibly tell its buyer that it buys "from this shop", so
    // purchasing flows read as our own procurement instead.
    .replace(/(?:按预约顺序|按预定顺序)?向供货商(?:采购|下单)/g, "安排采购")
    .replace(/向供货商/g, "安排")
    .replace(/货源店铺|货源方|供货商|供货方|上游供应商|供应商/g, "本店")
    .replace(/货源/g, "本店")
    // Wholesale vocabulary ("批量拿货", "进价", "成本价") tells the buyer this
    // shop resells someone else's stock. Product copy only needs the retail
    // action, so read it as an ordinary purchase.
    .replace(/批量拿货|批发拿货/g, "批量购买")
    .replace(/拿货/g, "购买")
    .replace(/进价|成本价|代理价|批发价/g, "价格")
    .replace(
      /\b(?:supplier|vendor|wholesaler|upstream\s+(?:shop|supplier)|wholesale\s+price|agent\s+price|cost\s+price)\b/gi,
      "本店",
    )
    .replace(/本店本店/g, "本店");

  // Settlement arithmetic must not reach buyers, in plain copy or mirrored
  // help articles. Rich HTML removes whole blocks; this covers everything else.
  text = stripSettlementCopy(text);

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
      // A masked link is not useful on its own. When the surrounding words
      // already name the destination ("打开兑换网站 ..."), appending the
      // placeholder reads as broken copy, so point to where the address is
      // actually delivered instead.
      if (trimmed.includes(SUPPLIER_PLACEHOLDER)) {
        let line = trimmed.replace(
          /((?:打开|访问|进入|前往)\s*)?(兑换网站|兑换页面|兑换网址|充值网站|充值页面|网站|网址|地址|链接)\s*本站商品页/g,
          (_match, verb: string | undefined, noun: string) =>
            noun === "地址" || noun === "链接"
              ? `${verb ?? ""}${noun}（见订单详情页）`
              : `${verb ?? ""}${noun}（地址见订单详情页）`,
        );
        line = line.replace(
          /(?:打开|访问|进入|前往)\s*本站商品页/g,
          "打开订单详情页中的兑换地址",
        );
        if (!line.includes(SUPPLIER_PLACEHOLDER)) return line;
        if (line.includes("视频教程")) {
          return line.replaceAll(SUPPLIER_PLACEHOLDER, "本页下方视频教程");
        }
        if (line.includes("教程")) {
          return line.replaceAll(SUPPLIER_PLACEHOLDER, "本页教程");
        }
        return line;
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
