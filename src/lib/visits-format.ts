/**
 * Pure helpers for the first-visit log. Kept free of DB/env imports so the
 * visitor page, the tracking route and scripts/test-visits.ts can share them.
 */

export const VISITOR_COOKIE = "cokeai_vid";
export const VISITOR_RETENTION_DAYS = 30;

const MAX_TEXT = 300;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Client-side visitor id; shared by the beacon and usable in tests. */
export function createVisitorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Full IP stays in the database; only the admin page renders this version. */
export function maskIp(ip: string | null | undefined): string {
  const value = (ip || "").trim();
  if (!value || value === "local" || value === "unknown") return "—";
  if (value.includes(":")) {
    if (value === "::1") return "::1";
    const groups = value.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}:*` : "—";
  }
  const octets = value.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d+$/.test(part))) {
    return `${octets.slice(0, 3).join(".")}.*`;
  }
  return "—";
}

/**
 * Referrer is stored as `host/path` only: query strings can carry tokens or
 * personal data, and the admin only needs to know where the visit came from.
 */
export function sanitizeReferrer(
  raw: string | null | undefined,
  siteHost?: string,
): string {
  const value = (raw || "").trim();
  if (!value) return "直接访问";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "直接访问";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "直接访问";
  if (siteHost && url.host === siteHost) return "站内";
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.host}${path}`.slice(0, MAX_TEXT);
}

export function normalizeLandingPath(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  const path = value.split(/[?#]/, 1)[0].slice(0, MAX_TEXT) || "/";
  // Order numbers must not leak into the visitor log.
  return path
    .replace(/^\/shop\/orders\/[^/]+/, "/shop/orders/:id")
    .replace(/^\/shop\/checkout\/[^/]+/, "/shop/checkout/:id");
}

export function isBotUserAgent(ua: string | null | undefined): boolean {
  const value = (ua || "").trim();
  if (!value) return true;
  return /bot|crawl|spider|slurp|bingpreview|headlesschrome|phantomjs|puppeteer|playwright|curl\/|wget\/|python-requests|go-http-client|okhttp|httpclient|lighthouse|facebookexternalhit|telegrambot/i.test(
    value,
  );
}

export function describeUserAgent(ua: string | null | undefined): string {
  const value = (ua || "").toLowerCase();
  if (!value) return "未知设备";

  const os = /iphone|ipad|ipod/.test(value)
    ? "iOS"
    : /android/.test(value)
      ? "Android"
      : /windows/.test(value)
        ? "Windows"
        : /mac os x|macintosh/.test(value)
          ? "macOS"
          : /linux/.test(value)
            ? "Linux"
            : "未知系统";

  const browser = /edg\//.test(value)
    ? "Edge"
    : /micromessenger/.test(value)
      ? "微信"
      : /chrome|crios/.test(value)
        ? "Chrome"
        : /firefox|fxios/.test(value)
          ? "Firefox"
          : /safari/.test(value)
            ? "Safari"
            : "未知浏览器";

  const mobile = /mobile|iphone|ipad|ipod|android/.test(value);
  return `${os} · ${browser}${mobile ? " · 移动端" : ""}`;
}

/* ---------------------------------------------------------------------------
 * 所在地：来自 Cloudflare 的请求标头，在写入首访时一次性落库
 *
 * 隧道前面是 Cloudflare，源站能在请求头里读到访客归属：
 *   cf-ipcountry          所有套餐都有；XX / T1 表示无法判定
 *   cf-region / cf-city   需要在 Cloudflare 后台开启「添加访客位置标头」免费托管转换
 * 省份/城市名可能是 URL 编码的，这里统一解码、去掉控制字符并截断。
 * ------------------------------------------------------------------------- */

const MAX_GEO = 60;

export function normalizeGeoText(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value) return "";
  let decoded = value;
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
  }
  // 控制字符先换成一个空格再折叠，避免 "A\tB" 被粘成 "AB"。
  const cleaned = decoded
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 按码点截断，避免把 emoji 之类的代理对切成半个字符。
  const chars = Array.from(cleaned);
  return chars.length > MAX_GEO ? chars.slice(0, MAX_GEO).join("") : cleaned;
}

/** 国家/地区代码 → 中文名；未收录的代码原样显示，判不出时返回空串。 */
const COUNTRY_NAMES: Record<string, string> = {
  CN: "中国",
  HK: "中国香港",
  MO: "中国澳门",
  TW: "中国台湾",
  US: "美国",
  CA: "加拿大",
  MX: "墨西哥",
  BR: "巴西",
  AR: "阿根廷",
  CL: "智利",
  CO: "哥伦比亚",
  PE: "秘鲁",
  VE: "委内瑞拉",
  EC: "厄瓜多尔",
  UY: "乌拉圭",
  PY: "巴拉圭",
  BO: "玻利维亚",
  CU: "古巴",
  DO: "多米尼加",
  GT: "危地马拉",
  CR: "哥斯达黎加",
  PA: "巴拿马",
  JP: "日本",
  KR: "韩国",
  SG: "新加坡",
  MY: "马来西亚",
  TH: "泰国",
  VN: "越南",
  PH: "菲律宾",
  ID: "印度尼西亚",
  IN: "印度",
  PK: "巴基斯坦",
  BD: "孟加拉国",
  LK: "斯里兰卡",
  NP: "尼泊尔",
  KH: "柬埔寨",
  MM: "缅甸",
  LA: "老挝",
  MN: "蒙古",
  KZ: "哈萨克斯坦",
  UZ: "乌兹别克斯坦",
  AE: "阿联酋",
  SA: "沙特阿拉伯",
  QA: "卡塔尔",
  KW: "科威特",
  BH: "巴林",
  OM: "阿曼",
  JO: "约旦",
  LB: "黎巴嫩",
  IL: "以色列",
  TR: "土耳其",
  IR: "伊朗",
  IQ: "伊拉克",
  SY: "叙利亚",
  YE: "也门",
  AF: "阿富汗",
  RU: "俄罗斯",
  UA: "乌克兰",
  BY: "白俄罗斯",
  PL: "波兰",
  DE: "德国",
  FR: "法国",
  GB: "英国",
  IE: "爱尔兰",
  NL: "荷兰",
  BE: "比利时",
  LU: "卢森堡",
  CH: "瑞士",
  AT: "奥地利",
  IT: "意大利",
  ES: "西班牙",
  PT: "葡萄牙",
  GR: "希腊",
  SE: "瑞典",
  NO: "挪威",
  DK: "丹麦",
  FI: "芬兰",
  IS: "冰岛",
  CZ: "捷克",
  SK: "斯洛伐克",
  HU: "匈牙利",
  RO: "罗马尼亚",
  BG: "保加利亚",
  HR: "克罗地亚",
  SI: "斯洛文尼亚",
  RS: "塞尔维亚",
  BA: "波黑",
  MK: "北马其顿",
  AL: "阿尔巴尼亚",
  EE: "爱沙尼亚",
  LV: "拉脱维亚",
  LT: "立陶宛",
  MD: "摩尔多瓦",
  GE: "格鲁吉亚",
  AM: "亚美尼亚",
  AZ: "阿塞拜疆",
  AU: "澳大利亚",
  NZ: "新西兰",
  ZA: "南非",
  EG: "埃及",
  MA: "摩洛哥",
  DZ: "阿尔及利亚",
  TN: "突尼斯",
  LY: "利比亚",
  NG: "尼日利亚",
  KE: "肯尼亚",
  GH: "加纳",
  ET: "埃塞俄比亚",
  TZ: "坦桑尼亚",
  UG: "乌干达",
  RW: "卢旺达",
  ZW: "津巴布韦",
  ZM: "赞比亚",
  AO: "安哥拉",
  MZ: "莫桑比克",
  CM: "喀麦隆",
  SN: "塞内加尔",
  CI: "科特迪瓦",
  SD: "苏丹",
  SO: "索马里",
};

export function countryLabel(code: string | null | undefined): string {
  const value = normalizeGeoText(code).toUpperCase().slice(0, 2);
  if (!value || value === "XX" || value === "T1") return "";
  return COUNTRY_NAMES[value] || value;
}

/** 「中国 · 河南 · 郑州」；没有任何可用信息时返回「—」。 */
export function formatLocation(
  country: string | null | undefined,
  region: string | null | undefined,
  city: string | null | undefined,
): string {
  const parts = [
    countryLabel(country),
    normalizeGeoText(region),
    normalizeGeoText(city),
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}
