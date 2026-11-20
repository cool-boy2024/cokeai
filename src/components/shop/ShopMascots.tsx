"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SUPPLIER_PLACEHOLDER, sanitizeSupplierCopy } from "@/lib/shop/sanitize";
import { ShopMascotIdlePose } from "./ShopMascotArt";
import type { ShopMascotEyes, ShopMascotKind, ShopMascotState } from "./ShopMascotArt";
import { createTraveler, spawnSparks, type MascotPoint, type Traveler } from "./mascotTravel";

const KINDS = ["claude", "gpt", "grok"] as const satisfies readonly ShopMascotKind[];
type Kind = (typeof KINDS)[number];

const DESKTOP_SIZE = 84;
const MOBILE_SIZE = 48;
const EDGE_GAP = 22;
const TOP_SAFE = 96;
const SUPPORT_PAD = 10;
const BUBBLE_HOLD_MS = 3400;
const BUBBLE_EDGE = 12;
/** 介绍气泡收掉后再等 0.6-0.9s，才问「要我带你去看吗」，不抢话。 */
const GUIDE_DELAY_MIN_MS = 600;
const GUIDE_DELAY_MAX_MS = 900;
/** 带按钮的气泡停留时间；点按钮 / 滚动 / 点别处都会提前收。 */
const GUIDE_HOLD_MS = 6000;
/** 每只桌宠每会话最多带路 2 次。 */
const GUIDE_SESSION_MAX = 2;
const PATROL_MIN_MS = 9000;
const PATROL_MAX_MS = 15000;
const ACT_MIN_MS = 7000;
const ACT_MAX_MS = 13500;
const BLINK_MIN_MS = 2400;
const BLINK_MAX_MS = 6000;
const SACCADE_MIN_MS = 1500;
const SACCADE_MAX_MS = 4000;
const DOZE_MS = 120_000;
/** 第一场互动 12-20s 内必来一次，之后 25-45s 冷却，每会话最多 10 场。 */
const FIRST_INTERACTION_MIN_MS = 12_000;
const FIRST_INTERACTION_MAX_MS = 20_000;
const INTERACTION_MIN_MS = 25_000;
const INTERACTION_MAX_MS = 45_000;
const INTERACTION_RETRY_MS = 3000;
const INTERACTION_SESSION_MAX = 10;
/** 详情页入场：三只间隔 150ms 从屏幕左缘依次跳进来。 */
const ENTRY_STAGGER_MS = 150;
const SPARK_BUDGET = 2;
const CARD_GAP = 12;
const SLOT_GAP = 10;
const INTERACTION_KEY = "cokeai:mascot-interactions";
const GUIDE_KEY = "cokeai:mascot-guides";
const SPARK_KEY = "cokeai:mascot-sparkles";
const POS_KEY = "cokeai:mascot-pos";
const PATH_KEY = "cokeai:mascot-path";
const PAID_KEY = "cokeai:shop-paid-at";
const PAID_WINDOW_MS = 30_000;
const CARD_SELECTOR = "a.shop-row, a.shop-product-card";
/** 后台页不挂桌宠，公开页全程跟着客户走。 */
const HIDDEN_PREFIXES = ["/admin", "/dashboard"];
/** 商品详情页：/shop/<slug>，购买须知 / 结账 / 订单这些固定段不算。 */
const DETAIL_PATH = /^\/shop\/(?!terms(?:\/|$)|checkout(?:\/|$)|orders(?:\/|$))[^/]+\/?$/;

type CardInfo = {
  name: string;
  price: string | null;
  warranty: string | null;
  sales: string | null;
};

/**
 * 气泡按钮：要么跳到卡片自己的详情链接，要么滚到本页的下单区。
 * 跳转只认卡片上读到的真实 href，不按 slug 拼 URL。
 */
type BubbleAction = { label: string; href: string } | { label: string; scroll: "buy" };

type Bubble = { text: string; action: BubbleAction | null };

/** 气泡去重只看文本和按钮指向，不比较对象身份。 */
function actionKey(action: BubbleAction | null): string {
  if (!action) return "";
  return "href" in action ? `href:${action.href}` : `scroll:${action.scroll}`;
}

/** 闲置剧目用的状态；P1 已把它们并进 ShopMascotState，这里留个别名让消费端读得懂。 */
type ActState = ShopMascotState | "type" | "build" | "music" | "juggle";

type Pose = { state: ActState; eyes: ShopMascotEyes };

/** 只跨页记坐标；姿态（尤其睡眠）不落库，回到页面一律从 idle 重新开始。 */
type StoredSpot = { x: number; y: number };

const IDLE_POSE: Pose = { state: "idle", eyes: "open" };

type Runtime = {
  x: number;
  y: number;
  /** 认领落点相对卡片顶边的偏移，滚动时靠它只改 y，不乱换边。 */
  offsetY: number;
  target: HTMLElement | null;
  hovering: boolean;
  patrolTimer: number;
  actTimer: number;
  blinkTimer: number;
  blinkClearTimer: number;
  saccadeTimer: number;
  poseTimer: number;
  classTimer: number;
};

const CLICK_LINE = "跟着我看好货 →";

/** 认领到的卡片没货时只说这一句：不催、不承诺补货时间。 */
const NO_STOCK_LINE = "这件暂时没货，看看别的～";

const FALLBACK_LINES = ["点我直接看", "热卖中！点我看看", CLICK_LINE];

/** 没有 Grok 商品可认领时，小黑球当快乐巡游员，不硬造商品关联。 */
const GROK_ROAM_LINES = ["巡场中，随便看看", "Grok 也在小店里", "有货就冲！"];

const GREET_LINES: Record<Kind, string[]> = {
  claude: ["刚那单秒发！", "稳住，这单我来"],
  gpt: ["稳～", "云宝在线接单"],
  grok: ["巡场收到", "这单我盯着"],
};

const PHOTO_LINES: Record<Kind, string> = {
  claude: "来，比个耶！",
  gpt: "茄子～",
  grok: "咔嚓！",
};

const FIGHT_LINES: Record<Kind, string[]> = {
  claude: ["我的用户更多！", "这单我先接的"],
  gpt: ["就你这销量？", "云宝比你快一步"],
  grok: ["别吵，看数据", "我的延迟更低"],
};

const MAKE_UP_LINES: Record<Kind, string[]> = {
  claude: ["不吵了，一起发财", "握手，分你一半"],
  gpt: ["行吧，你也不差", "和好～"],
  grok: ["数据都不错，收工", "和气生财"],
};

/** 详情页没有本家品牌时的收尾话术，只让巡游员开口。 */
const NO_BRAND_LINES = ["没我们仨的 logo，我押它好卖", "不是我的柜台，但值得看看"];

const DETAIL_LINES: Record<Kind, string> = {
  claude: "这件我代言的",
  gpt: "我家的货，放心拍",
  grok: "这件我盯着",
};

const LABELS: Record<Kind, string> = {
  claude: "星芒侠：带你看 Claude 商品",
  gpt: "云宝：带你看 ChatGPT 商品",
  grok: "小黑球：带你看 Grok 商品",
};

/** 闲置剧目：每只错开顺序和起始相位，画面里三只不会同时做同一件事。 */
const ACT_PLAN: Record<Kind, readonly ActState[]> = {
  claude: ["build", "type", "music"],
  gpt: ["music", "type", "build"],
  grok: ["juggle", "music", "type"],
};

const ACT_EYES: Partial<Record<ActState, ShopMascotEyes>> = {
  type: "open",
  build: "open",
  music: "happy",
  juggle: "happy",
};

/**
 * 话术只取商品卡上的名称、价格、质保、已售；名称先过供应商文案清洗，
 * 所以气泡里不会出现货源域名、「货源」字样或外链。
 */
function bubbleLines(info: CardInfo): string[] {
  const short = shortName(info.name, 11);
  const full = shortName(info.name, 14);
  // 名字整条都是脱敏占位符时没有可说的词，退回通用话术。
  if (!short) return FALLBACK_LINES;
  const lines = [`${short} · ${info.price ?? "点我看看"}`, `点我看看${short}`];
  if (info.warranty) lines.push(`${full} · ${info.warranty}`);
  if (info.sales) lines.push(`${short} · ${info.sales}`);
  if (info.price) lines.push(`${short}，${info.price}`);
  return lines;
}

/** 商品名里的【直充｜月卡】是卖点后缀，气泡里只留商品本名。 */
function shortName(name: string, limit: number): string {
  const head = name.split(/【|\[|（|\(|｜|\|/)[0]?.trim() || "";
  return truncate(head.length >= 2 ? head : name, limit);
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  if (chars.length <= limit) return clean;
  let end = limit;
  // 占位符是脱敏时整词换上去的，截成半截会读成「Claude Pro 本…」：
  // 截断点落进占位符就整词丢掉，而不是留半截。
  let at = clean.indexOf(SUPPLIER_PLACEHOLDER);
  while (at !== -1) {
    const start = Array.from(clean.slice(0, at)).length;
    const stop = start + Array.from(SUPPLIER_PLACEHOLDER).length;
    if (start < end && end < stop) end = start;
    at = clean.indexOf(SUPPLIER_PLACEHOLDER, at + 1);
  }
  const cut = chars.slice(0, end).join("");
  // 截断点落在英文单词中间时退回上一个空格，别留下 "Claude pr…"。
  // 中文没有空格，只去掉悬空的标点；回退会砍掉大半句时也宁可硬截断。
  const space = cut.lastIndexOf(" ");
  const word =
    cut.endsWith(" ") || !/[A-Za-z0-9]$/.test(cut) || space * 10 < limit * 7
      ? cut
      : cut.slice(0, space);
  const head = word.replace(/[\s·｜,，、-]+$/, "");
  return head ? `${head}…` : clean;
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function kindsFromText(text: string): Kind[] {
  const haystack = text.toLowerCase();
  const kinds: Kind[] = [];
  if (/claude|anthropic/.test(haystack)) kinds.push("claude");
  if (/gpt|openai|chatgpt|codex/.test(haystack)) kinds.push("gpt");
  if (/grok|\bxai\b|x\.ai/.test(haystack)) kinds.push("grok");
  return kinds;
}

/** 商品卡没有 data-category：按标题 + 品牌关键词归类，命中几个算几个。 */
function cardKinds(card: HTMLElement): Kind[] {
  const name = card.querySelector("h3")?.textContent || "";
  const brand =
    card.querySelector(".shop-row-kicker span, .shop-product-brand")?.textContent || "";
  return kindsFromText(`${name} ${brand}`);
}

function readCard(card: HTMLElement): CardInfo {
  const text = card.textContent || "";
  const name =
    sanitizeSupplierCopy(card.querySelector("h3")?.textContent?.trim() || "") || "这件商品";
  const price = text.match(/¥\s*[0-9][0-9,]*(?:\.[0-9]+)?/)?.[0]?.replace(/\s+/g, "") ?? null;
  const warranty = text.match(/质保\s*[0-9]+\s*天|首登质保|无质保/)?.[0] ?? null;
  const sales =
    card.querySelector(".shop-row-sales, .shop-product-sales")?.textContent?.trim() ?? null;
  return { name, price, warranty, sales };
}

/** 没货文案：售罄 / 补货 / 缺货 / 约满 / 暂无。徽章和下单区共用这一条规则。 */
const OUT_OF_STOCK_TEXT = /售罄|补货|缺货|约满|暂无/;

/**
 * 卡片有没有货。绿色 / 黄色可用性徽章算有货；`.is-sold-out` 或徽章文案命中
 * 没货词算没货。两边都有信号时按没货算：宁可不带路，也不把客户送到没货的卡片。
 */
function cardInStock(card: HTMLElement): boolean {
  const inStock = !!card.querySelector(".shop-badge-green, .shop-badge-yellow");
  const badges = Array.from(card.querySelectorAll<HTMLElement>(".shop-badge"));
  const soldOut =
    !!card.querySelector(".is-sold-out") ||
    badges.some((badge) => OUT_OF_STOCK_TEXT.test(badge.textContent || ""));
  return inStock && !soldOut;
}

/** 详情页的标题 / 质保 / 品牌；标题也走供应商文案清洗。 */
function readDetail(): { name: string; warranty: string | null; kinds: Kind[] } {
  const meta = document.querySelector<HTMLElement>(".shop-detail-meta");
  const rawName =
    meta?.querySelector("h1")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    "";
  const name = sanitizeSupplierCopy(rawName) || "这件商品";
  const brand = meta?.querySelector(".shop-product-brand")?.textContent || "";
  const subtitle = meta?.querySelector("p")?.textContent || "";
  const badges = document.querySelector<HTMLElement>(".shop-detail-badges")?.textContent || "";
  const warranty = badges.match(/质保\s*[0-9]+\s*天|首登质保|无质保/)?.[0] ?? null;
  return { name, warranty, kinds: kindsFromText(`${brand} ${rawName} ${subtitle}`) };
}

function isDetailPath(pathname: string): boolean {
  return DETAIL_PATH.test(pathname);
}

function hiddenOnPath(pathname: string): boolean {
  return HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function readStoredSpots(): Record<Kind, StoredSpot> | null {
  try {
    const raw = window.sessionStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<Kind, StoredSpot>>;
    const next = {} as Record<Kind, StoredSpot>;
    for (const kind of KINDS) {
      const spot = parsed[kind];
      if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return null;
      next[kind] = spot;
    }
    return next;
  } catch {
    return null;
  }
}

function writeStoredSpots(spots: Record<Kind, StoredSpot>): void {
  try {
    window.sessionStorage.setItem(POS_KEY, JSON.stringify(spots));
  } catch {
    // 隐私模式写不进去，位置只留在内存里。
  }
}

function readStoredPath(): string {
  try {
    return window.sessionStorage.getItem(PATH_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredPath(pathname: string): void {
  try {
    window.sessionStorage.setItem(PATH_KEY, pathname);
  } catch {
    // 同上，导航来源记不住就按普通入场处理。
  }
}

/** 本会话的带路配额：每只最多 GUIDE_SESSION_MAX 次，同一商品只带一次。 */
type GuideLog = { counts: Record<Kind, number>; items: string[] };

/** 隐私模式写不进 sessionStorage 时靠这份内存兜底，刷新即重置。 */
let guideCache: GuideLog | null = null;

function emptyGuideLog(): GuideLog {
  return { counts: { claude: 0, gpt: 0, grok: 0 }, items: [] };
}

function readGuideLog(): GuideLog {
  if (guideCache) return guideCache;
  const log = emptyGuideLog();
  try {
    const raw = window.sessionStorage.getItem(GUIDE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<GuideLog>) : null;
    for (const kind of KINDS) {
      const count = parsed?.counts?.[kind];
      log.counts[kind] = Number.isFinite(count) && Number(count) > 0 ? Number(count) : 0;
    }
    if (Array.isArray(parsed?.items)) {
      log.items = parsed.items.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // 解析失败就按没带过路处理，最多多问一次。
  }
  guideCache = log;
  return log;
}

function writeGuideLog(log: GuideLog): void {
  guideCache = log;
  try {
    window.sessionStorage.setItem(
      GUIDE_KEY,
      JSON.stringify({ counts: log.counts, items: log.items.slice(-60) }),
    );
  } catch {
    // 写不进去也留着内存副本，本页不会重复问。
  }
}

/**
 * 详情页的下单入口：优先专用钩子，其次文案命中的 CTA。
 * 找不到就返回 null，这种情况宁可不给按钮，也不要指错地方。
 */
function buyHintTarget(): HTMLElement | null {
  const panel = document.querySelector<HTMLElement>(".shop-detail-buy, .shop-buy-panel");
  if (panel) return panel;
  return (
    Array.from(document.querySelectorAll<HTMLElement>("button, a")).find((el) =>
      /立即购买|立即下单|马上购买|去下单/.test(el.textContent || ""),
    ) ?? null
  );
}

function newRuntime(): Runtime {
  return {
    x: 0,
    y: 0,
    offsetY: 0,
    target: null,
    hovering: false,
    patrolTimer: 0,
    actTimer: 0,
    blinkTimer: 0,
    blinkClearTimer: 0,
    saccadeTimer: 0,
    poseTimer: 0,
    classTimer: 0,
  };
}

function paidTimestamp(): number {
  try {
    const raw = window.sessionStorage.getItem(PAID_KEY);
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

export function ShopMascots() {
  const [bubbles, setBubbles] = useState<Record<Kind, Bubble | null>>({
    claude: null,
    gpt: null,
    grok: null,
  });
  const [poses, setPoses] = useState<Record<Kind, Pose>>({
    claude: IDLE_POSE,
    gpt: IDLE_POSE,
    grok: IDLE_POSE,
  });

  const nodesRef = useRef<Record<Kind, HTMLDivElement | null>>({
    claude: null,
    gpt: null,
    grok: null,
  });
  const liftRef = useRef<Record<Kind, HTMLSpanElement | null>>({
    claude: null,
    gpt: null,
    grok: null,
  });
  const stanceRef = useRef<Record<Kind, HTMLSpanElement | null>>({
    claude: null,
    gpt: null,
    grok: null,
  });
  const fxRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Record<Kind, Runtime>>({
    claude: newRuntime(),
    gpt: newRuntime(),
    grok: newRuntime(),
  });
  const bubbleTimers = useRef<Record<Kind, number>>({ claude: 0, gpt: 0, grok: 0 });
  /** 带路气泡的延时器：介绍气泡落地后才起，换页 / 打断时一起清。 */
  const guideTimers = useRef<Record<Kind, number>>({ claude: 0, gpt: 0, grok: 0 });
  /** 当前气泡的文本：带路延时到点时用它确认介绍还没被别的台词顶掉。 */
  const bubbleTextRef = useRef<Record<Kind, string | null>>({
    claude: null,
    gpt: null,
    grok: null,
  });
  /** 当前挂着的按钮：滚动、点别处、卸载时按它判断要不要收气泡。 */
  const actionRef = useRef<Record<Kind, BubbleAction | null>>({
    claude: null,
    gpt: null,
    grok: null,
  });
  const apiRef = useRef<{
    activate: (kind: Kind) => void;
    hover: (kind: Kind, on: boolean) => void;
  } | null>(null);

  const showBubble = useCallback(
    (kind: Kind, text: string, hold = BUBBLE_HOLD_MS, action: BubbleAction | null = null) => {
      window.clearTimeout(bubbleTimers.current[kind]);
      actionRef.current[kind] = action;
      bubbleTextRef.current[kind] = text;
      // 新台词顶上来就作废这次还没冒头的带路追问：十几秒后的老定时器不该抢话。
      window.clearTimeout(guideTimers.current[kind]);
      guideTimers.current[kind] = 0;
      setBubbles((prev) => {
        const current = prev[kind];
        if (current && current.text === text && actionKey(current.action) === actionKey(action)) {
          return prev;
        }
        return { ...prev, [kind]: { text, action } };
      });
      bubbleTimers.current[kind] = window.setTimeout(() => {
        actionRef.current[kind] = null;
        bubbleTextRef.current[kind] = null;
        setBubbles((prev) => ({ ...prev, [kind]: null }));
      }, hold);
    },
    [],
  );

  const hideBubble = useCallback((kind: Kind, delay = 0) => {
    window.clearTimeout(bubbleTimers.current[kind]);
    actionRef.current[kind] = null;
    bubbleTextRef.current[kind] = null;
    if (delay <= 0) {
      setBubbles((prev) => (prev[kind] ? { ...prev, [kind]: null } : prev));
      return;
    }
    bubbleTimers.current[kind] = window.setTimeout(() => {
      actionRef.current[kind] = null;
      bubbleTextRef.current[kind] = null;
      setBubbles((prev) => ({ ...prev, [kind]: null }));
    }, delay);
  }, []);

  // 只跟 pathname：useSearchParams 在根 layout 里会逼静态页整页转客户端渲染，
  // 分类 / 搜索换页由下面的卡片同步兜住。
  const pathname = usePathname();
  const hidden = hiddenOnPath(pathname);
  const router = useRouter();

  useEffect(() => {
    if (hidden) return;
    const runtime = runtimeRef.current;
    const nodes = nodesRef.current;
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const claims = new Map<Element, Kind>();
    const lastPose: Record<Kind, Pose> = {
      claude: IDLE_POSE,
      gpt: IDLE_POSE,
      grok: IDLE_POSE,
    };
    let disposed = false;
    let reconcileTimer = 0;
    let resizeTimer = 0;
    let scrollFrame = 0;
    let scrollTimer = 0;
    let idleTimer = 0;
    let interactionTimer = 0;
    let interacting = false;
    let interactionGen = 0;
    let sleeping = false;
    let sparkUsed = 0;
    let lastActivity = 0;
    let interactionCount = 0;
    let enteringDetail = false;
    // 入场跳进来这几秒先不安排互动，别让「碰头问好」截掉详情页的介绍气泡。
    let interactionBlockedUntil = 0;

    try {
      interactionCount = Number(window.sessionStorage.getItem(INTERACTION_KEY) ?? "0") || 0;
      sparkUsed = Number(window.sessionStorage.getItem(SPARK_KEY) ?? "0") || 0;
    } catch {
      interactionCount = 0;
      sparkUsed = 0;
    }

    // 移动端和「减少动态效果」都只做静态站立，区别是移动端仍占三个角。
    const isStatic = () => reducedQuery.matches || mobileQuery.matches;
    const mascotSize = () => (mobileQuery.matches ? MOBILE_SIZE : DESKTOP_SIZE);

    const travelers = {} as Record<Kind, Traveler | null>;
    for (const kind of KINDS) {
      const root = nodes[kind];
      const lift = liftRef.current[kind];
      const stance = stanceRef.current[kind];
      travelers[kind] =
        root && lift && stance
          ? createTraveler({
              layers: { root, lift, stance },
              size: mascotSize,
              fx: () => (isStatic() ? null : fxRef.current),
              reduced: () => isStatic(),
            })
          : null;
    }

    const viewport = () => {
      const root = document.documentElement;
      return { vw: root.clientWidth, vh: root.clientHeight };
    };

    // 安全区由 CSS 变量 --safe-bottom 统一交给 JS（env() 只在 CSS 里可用），
    // 尺寸变化时重读，不跟着每次移动去碰布局。
    let bottomInset = 0;
    const readBottomInset = () => {
      const value = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom"),
      );
      bottomInset = Number.isFinite(value) && value > 0 ? value : 0;
    };
    readBottomInset();

    // 移动端商品页有吸底购买栏，那是客户最该点到的按钮，角色底边要让开。
    let buyBar = 0;
    const readBuyBar = () => {
      const el = document.querySelector<HTMLElement>(".shop-mobile-buy");
      if (!el || el.classList.contains("is-hidden")) {
        buyBar = 0;
        return;
      }
      const rect = el.getBoundingClientRect();
      const { vh } = viewport();
      buyBar = rect.height > 2 && rect.bottom > vh - 4 ? rect.height : 0;
    };
    readBuyBar();

    /** 角色下沿的可用最低点：留出边距、安全区和移动端购买栏。 */
    const bottomBaseline = () => {
      const { vh } = viewport();
      const guard = Math.max(bottomInset, buyBar);
      return Math.max(EDGE_GAP, vh - EDGE_GAP - mascotSize() - guard);
    };

    const supportBox = () => {
      const el = document.querySelector<HTMLElement>(".support-widget");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      return {
        left: rect.left - SUPPORT_PAD,
        top: rect.top - SUPPORT_PAD,
        right: rect.right + SUPPORT_PAD,
        bottom: rect.bottom + SUPPORT_PAD,
      };
    };

    const limits = () => {
      const { vw, vh } = viewport();
      const size = mascotSize();
      return {
        minX: EDGE_GAP,
        maxX: Math.max(EDGE_GAP, vw - EDGE_GAP - size),
        minY: Math.min(TOP_SAFE, Math.max(EDGE_GAP, vh - size - EDGE_GAP)),
        maxY: bottomBaseline(),
      };
    };

    const hitsSupport = (x: number, y: number, size: number, box = supportBox()) => {
      if (!box) return false;
      return x + size > box.left && x < box.right && y + size > box.top && y < box.bottom;
    };

    const clampSpot = (x: number, y: number, size: number) => {
      const { minX, maxX, minY, maxY } = limits();
      return {
        x: Math.min(Math.max(x, minX), maxX),
        y: Math.min(Math.max(y, minY), maxY),
      };
    };

    /**
     * 落点最终闸门：常驻守位 / 认领侧位 / 待机位出点统一夹进 [8, vw-size-8]，
     * 球体右缘永远留在视口内，不再依赖各选点函数各自的边界判断。
     * 夹取后若压到客服按钮，避让优先级更高，抬回按钮上方。
     * （详情页入场 snap 到左缘外是有意为之，那条路径不走这里。）
     */
    const pinInsideViewport = (spot: MascotPoint): MascotPoint => {
      const size = mascotSize();
      const { vw } = viewport();
      const x = clamp(spot.x, 8, Math.max(8, vw - size - 8));
      const box = supportBox();
      if (box && hitsSupport(x, spot.y, size, box)) {
        const { minY, maxY } = limits();
        return { x, y: clamp(box.top - size - 10, minY, maxY) };
      }
      return { x, y: spot.y };
    };

    const onDetail = () => isDetailPath(pathname);

    /** 列表 / 首页才带路；详情页、结账、订单、须知这些页面都不问。 */
    const guidePath =
      !isDetailPath(pathname) && !/^\/shop\/(?:checkout|orders|terms)(?:\/|$)/.test(pathname);

    /** 客户正在填表时绝不插话，包括带按钮的那种。 */
    const editing = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    // 三只角色的待机位：星芒侠占左下、云宝居中、小黑球占右下。
    // 谁都不会压在右下角客服按钮上，也都会让开刘海屏底部的 Home 指示条。
    const cornerSpot = (kind: Kind) => {
      const { vw } = viewport();
      const size = mascotSize();
      const { maxX } = limits();
      let x = EDGE_GAP;
      if (kind === "grok") x = maxX;
      else if (kind === "gpt") x = Math.round(vw / 2 - size / 2);
      x = Math.min(Math.max(x, EDGE_GAP), maxX);
      // 待机位也统一过最终闸门（含客服按钮避让）。
      return pinInsideViewport({ x, y: bottomBaseline() });
    };

    const detailAnchor = () => {
      const node =
        document.querySelector<HTMLElement>(".shop-detail-main") ??
        document.querySelector<HTMLElement>(".shop-detail");
      return node?.getBoundingClientRect() ?? null;
    };

    // 详情页守位：优先蹲在商品卡左侧的栏间留白里（设计稿的「侧边探头看」），
    // 三只竖着排开，卡里的标题、价格、下单面板全都不会被挡。
    // 窄屏没有这段留白时，退回商品卡正下方的一排，仍然避开 CTA 与客服按钮。
    const detailSpot = (kind: Kind): MascotPoint => {
      const size = mascotSize();
      const { minX, maxX, minY, maxY } = limits();
      const { vw } = viewport();
      const order: Record<Kind, number> = { claude: 0, gpt: 1, grok: 2 };
      const cover =
        document.querySelector<HTMLElement>(".shop-detail-cover")?.getBoundingClientRect() ?? null;
      const anchor = detailAnchor();
      const leftEdge = cover?.left ?? anchor?.left ?? 0;
      const rightEdge = cover?.right ?? anchor?.right ?? vw;
      const gutter = leftEdge - size - CARD_GAP;
      const top = cover ? clamp(cover.top + 6, minY, maxY) : minY;
      const stackFits = cover ? top + 2 * (size + 10) <= maxY : false;
      const box = supportBox();

      if (stackFits && gutter >= minX - 2) {
        const spot = {
          x: clamp(gutter, minX, maxX),
          y: clamp(top + order[kind] * (size + 10), minY, maxY),
        };
        if (!box || !hitsSupport(spot.x, spot.y, size, box)) return pinInsideViewport(spot);
      }

      const left = clamp(leftEdge + 4, minX, maxX);
      const right = clamp(rightEdge - size - 4, left, maxX);
      const x =
        kind === "claude"
          ? left
          : kind === "grok"
            ? right
            : Math.round((left + right) / 2);
      let y = maxY;
      if (box && hitsSupport(x, y, size, box)) {
        y = clamp(box.top - size - 10, minY, maxY);
      }
      return pinInsideViewport({ x, y: clamp(y, minY, maxY) });
    };

    const homeSpot = (kind: Kind) => (onDetail() ? detailSpot(kind) : cornerSpot(kind));

    const moveTo = (
      kind: Kind,
      spot: MascotPoint,
      options: {
        drift?: boolean;
        hop?: boolean;
        onLand?: (at: MascotPoint) => void;
        onDone?: (at: MascotPoint) => void;
      } = {},
    ) => {
      const traveler = travelers[kind];
      if (!traveler) return;
      runtime[kind].x = spot.x;
      runtime[kind].y = spot.y;
      traveler.goTo({ to: spot, ...options });
    };

    const snapTo = (kind: Kind, spot: MascotPoint) => {
      const traveler = travelers[kind];
      if (!traveler) return;
      runtime[kind].x = spot.x;
      runtime[kind].y = spot.y;
      traveler.snap(spot);
    };

    const sendHome = (kind: Kind, animate: boolean) => {
      const spot = homeSpot(kind);
      if (animate) moveTo(kind, spot);
      else snapTo(kind, spot);
    };

    const setPose = (kind: Kind, patch: Partial<Pose>) => {
      lastPose[kind] = { ...lastPose[kind], ...patch };
      setPoses((prev) => {
        const current = prev[kind];
        const next = { ...current, ...patch };
        if (current.state === next.state && current.eyes === next.eyes) return prev;
        return { ...prev, [kind]: next };
      });
    };

    // 状态不硬切：表情 + 姿态整体换过去，hold 到了再回 idle，过渡交给造型层。
    const poseFor = (kind: Kind, state: ActState, eyes: ShopMascotEyes, hold = 0) => {
      window.clearTimeout(runtime[kind].poseTimer);
      setPose(kind, { state, eyes });
      if (hold > 0) {
        runtime[kind].poseTimer = window.setTimeout(() => {
          setPose(kind, IDLE_POSE);
        }, hold);
      }
    };

    const lookAt = (kind: Kind, x: number, y: number) => {
      const node = nodes[kind];
      if (!node) return;
      node.style.setProperty("--m-eye-x", `${Math.min(3, Math.max(-3, x)).toFixed(1)}px`);
      node.style.setProperty("--m-eye-y", `${Math.min(3, Math.max(-3, y)).toFixed(1)}px`);
    };

    const squash = (kind: Kind) => {
      const stance = stanceRef.current[kind];
      if (!stance) return;
      stance.classList.remove("is-land");
      void stance.offsetWidth;
      stance.classList.add("is-land");
      window.setTimeout(() => stance.classList.remove("is-land"), 140);
    };

    const cancelGuide = (kind: Kind) => {
      window.clearTimeout(guideTimers.current[kind]);
      guideTimers.current[kind] = 0;
    };

    /** 同一时刻只留一颗带路按钮：三只一起问就成了弹窗墙。 */
    const otherActionUp = (kind: Kind) =>
      KINDS.some((other) => other !== kind && actionRef.current[other]);

    const guideAllowed = (kind: Kind) =>
      !disposed &&
      !onDetail() &&
      !enteringDetail &&
      !interacting &&
      !sleeping &&
      !runtime[kind].hovering &&
      document.visibilityState === "visible" &&
      !editing() &&
      !otherActionUp(kind);

    /**
     * 带路配额统一在这里记账：每只桌宠每会话最多 GUIDE_SESSION_MAX 次，
     * 同一商品（或同一次详情页提示）只算一次。
     */
    const recordGuide = (kind: Kind, key: string): boolean => {
      const log = readGuideLog();
      if (log.counts[kind] >= GUIDE_SESSION_MAX || log.items.includes(key)) return false;
      log.counts[kind] += 1;
      log.items.push(key);
      writeGuideLog(log);
      return true;
    };

    /**
     * 真正弹「要我带你去看吗」，跳的是卡片上读到的真实 href。
     * 互斥也在这里判：认领追问和点桌宠两条路共用同一个入口，
     * 别的桌宠按钮还挂着就直接放弃，不弹第二颗。
     */
    const runGuide = (kind: Kind, href: string, card?: HTMLElement | null): boolean => {
      if (card && !cardInStock(card)) return false;
      if (!guidePath) return false;
      if (otherActionUp(kind)) return false;
      if (!recordGuide(kind, href)) return false;
      showBubble(kind, "要我带你去看吗？", GUIDE_HOLD_MS, { label: "带我去 →", href });
      return true;
    };

    /**
     * 认领介绍气泡收掉后再追问一句。任何一项条件不满足就整场跳过，
     * 不消耗配额，也不留半截定时器。
     */
    const scheduleGuide = (kind: Kind, card: HTMLElement, intro: string, after: number) => {
      cancelGuide(kind);
      if (!guidePath) return;
      guideTimers.current[kind] = window.setTimeout(() => {
        guideTimers.current[kind] = 0;
        if (!guideAllowed(kind)) return;
        // 介绍气泡这十几秒里可能被巡逻台词 / 互动台词顶掉，顶掉了就不追问。
        // 正常时序是介绍气泡先自然收起（ref 变 null），追问才到点；此时应放行。
        const current = bubbleTextRef.current[kind];
        if (current !== null && current !== intro) return;
        // 卡片被换掉（换分类 / 搜索）后就不再属于这只了，别带客户去旧货。
        if (!card.isConnected || runtime[kind].target !== card) return;
        // 没货的卡片不追问，也不记带路配额（记账在 runGuide 里）。
        if (!cardInStock(card)) return;
        const href = card.getAttribute("href");
        if (!href || !href.startsWith("/")) return;
        runGuide(kind, href, card);
      }, after + GUIDE_DELAY_MIN_MS + Math.random() * (GUIDE_DELAY_MAX_MS - GUIDE_DELAY_MIN_MS));
    };

    /**
     * 详情页介绍完再给个「就在这页」的下单提示；下单区找不到就不给按钮。
     */
    const scheduleDetailHint = (kind: Kind, hold: number) => {
      cancelGuide(kind);
      if (!onDetail()) return;
      guideTimers.current[kind] = window.setTimeout(() => {
        guideTimers.current[kind] = 0;
        if (
          disposed ||
          !onDetail() ||
          enteringDetail ||
          interacting ||
          sleeping ||
          runtime[kind].hovering ||
          document.visibilityState !== "visible" ||
          editing() ||
          otherActionUp(kind)
        ) {
          return;
        }
        const buy = buyHintTarget();
        if (!buy) return;
        // 下单区写着补货中 / 缺货时不给「带我去下单」按钮，免得把客户带去点不动的按钮。
        if (buy.querySelector(".is-sold-out") || OUT_OF_STOCK_TEXT.test(buy.textContent || "")) {
          return;
        }
        if (!recordGuide(kind, `detail:${pathname}:${kind}`)) return;
        showBubble(kind, "就在这页，往下滑下单 ↓", GUIDE_HOLD_MS, {
          label: "带我去下单 ↓",
          scroll: "buy",
        });
      }, hold + GUIDE_DELAY_MIN_MS);
    };

    const announceCard = (kind: Kind, card: HTMLElement) => {
      const line = pick(bubbleLines(readCard(card)));
      showBubble(kind, line);
      scheduleGuide(kind, card, line, BUBBLE_HOLD_MS);
    };

    const jumpToCard = (kind: Kind, card: HTMLElement, spot: MascotPoint) => {
      moveTo(kind, spot, { onLand: () => announceCard(kind, card) });
    };

    // 详情页入场后的介绍：只有本家品牌开口，品牌对不上就让巡游员说句俏皮话。
    const detailIntro = (kind: Kind) => {
      const info = readDetail();
      if (info.kinds.includes(kind)) {
        const head = `${DETAIL_LINES[kind]} · ${shortName(info.name, 12)}`;
        showBubble(kind, info.warranty ? `${head} · ${info.warranty}` : head, 4800);
        scheduleDetailHint(kind, 4800);
        return;
      }
      if (info.kinds.length === 0 && kind === "grok") {
        showBubble("grok", pick(NO_BRAND_LINES), 4600);
        scheduleDetailHint(kind, 4600);
      }
    };

    /**
     * 卡片侧位候选：只在自己这张卡片的竖向范围内取点，左右两侧各给上/中/下三条 lane；
     * 同一张卡挤三只时再往卡上方 / 下方各让一个位。任何候选都不会漂到邻卡的侧边，
     * 这是上一版「小黑球站到别人卡旁」的根因。
     */
    const cardSlots = (kind: Kind, rect: DOMRect): MascotPoint[] => {
      const size = mascotSize();
      const { minX, maxX, minY, maxY } = limits();
      const lane = (x: number, y: number): MascotPoint[] => {
        if (x < minX - 2 || x > maxX + 2) return [];
        return [{ x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) }];
      };
      const top = clamp(rect.top + 8, minY, maxY);
      const middle = clamp(rect.top + rect.height / 2 - size / 2, minY, maxY);
      const bottom = clamp(rect.bottom - size - 8, minY, maxY);
      const left = rect.left - size - CARD_GAP;
      const right = rect.right + CARD_GAP;
      const leftLanes = [
        ...lane(left, top),
        ...lane(left, middle),
        ...lane(left, bottom),
      ];
      const rightLanes = [
        ...lane(right, top),
        ...lane(right, middle),
        ...lane(right, bottom),
      ];
      // 星芒侠优先站左侧栏间留白，云宝和小黑球优先站右侧。
      const sides = kind === "claude" ? [...leftLanes, ...rightLanes] : [...rightLanes, ...leftLanes];
      const extra = [
        ...lane(rect.left + 4, rect.top - size - 8),
        ...lane(rect.left + 4, rect.bottom + 8),
      ];
      return [...sides, ...extra];
    };

    const spotNearCard = (
      kind: Kind,
      rect: DOMRect,
      occupied: MascotPoint[],
      blockers: DOMRect[],
    ): MascotPoint => {
      const size = mascotSize();
      const box = supportBox();
      const slots = cardSlots(kind, rect);
      const taken = (slot: MascotPoint) =>
        occupied.some((point) => Math.hypot(slot.x - point.x, slot.y - point.y) < size + SLOT_GAP) ||
        (box ? hitsSupport(slot.x, slot.y, size, box) : false) ||
        // 双列卡片时，侧位很可能正好压在隔壁那张卡上：压邻卡的候选一律不要。
        blockers.some(
          (other) =>
            slot.x + size > other.left - 4 &&
            slot.x < other.right + 4 &&
            slot.y + size > other.top - 4 &&
            slot.y < other.bottom + 4,
        );
      const free = slots.find((slot) => !taken(slot));
      if (free) return pinInsideViewport(free);
      // 全被占住时宁可贴着自己这张卡，也不挪到邻卡旁边去站。
      let best = slots[0];
      let bestCost = Number.POSITIVE_INFINITY;
      for (const slot of slots) {
        let cost =
          Math.hypot(slot.x - runtime[kind].x, slot.y - runtime[kind].y);
        for (const point of occupied) {
          cost += Math.max(
            0,
            size + SLOT_GAP - Math.hypot(slot.x - point.x, slot.y - point.y),
          ) * 2;
        }
        for (const other of blockers) {
          if (
            slot.x + size > other.left &&
            slot.x < other.right &&
            slot.y + size > other.top &&
            slot.y < other.bottom
          ) {
            cost += 400;
          }
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = slot;
        }
      }
      return pinInsideViewport(best);
    };

    const randomSpot = (kind: Kind) => {
      const rt = runtime[kind];
      const size = mascotSize();
      const { minX, maxX, minY, maxY } = limits();
      // 客服按钮的盒子在循环外量一次，16 个候选点不用反复读布局。
      const box = supportBox();
      let best = { x: rt.x, y: rt.y };
      let bestScore = -1;
      for (let i = 0; i < 16; i += 1) {
        const x = minX + Math.random() * Math.max(1, maxX - minX);
        const y = minY + Math.random() * Math.max(1, maxY - minY);
        if (hitsSupport(x, y, size, box)) continue;
        let apart = Number.POSITIVE_INFINITY;
        for (const other of KINDS) {
          if (other === kind) continue;
          apart = Math.min(apart, Math.hypot(x - runtime[other].x, y - runtime[other].y));
        }
        if (apart < size + 24) continue;
        // 既要有明显位移，又要离其他角色远一点。
        const score = Math.min(600, Math.hypot(x - rt.x, y - rt.y)) + apart * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
      return best;
    };

    const canAct = (kind: Kind) =>
      !disposed &&
      !isStatic() &&
      !enteringDetail &&
      !sleeping &&
      !interacting &&
      !runtime[kind].hovering &&
      !travelers[kind]?.busy;

    const schedulePatrol = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.patrolTimer);
      // 9-15s 一次抛物线巡逻跳；认领了商品就守在商品旁，详情页原地蹲守，都不抢镜。
      rt.patrolTimer = window.setTimeout(
        () => {
          if (canAct(kind) && !rt.target && !onDetail()) moveTo(kind, randomSpot(kind));
          schedulePatrol(kind);
        },
        PATROL_MIN_MS + Math.random() * (PATROL_MAX_MS - PATROL_MIN_MS),
      );
    };

    // 闲置剧目：搭货 / 敲字 / 哼歌 / 抛球轮换，三只的相位和顺序都错开。
    const actIndex: Record<Kind, number> = { claude: 0, gpt: 1, grok: 2 };

    const performAct = (kind: Kind) => {
      if (kind === "claude" && sparkUsed < SPARK_BUDGET && Math.random() < 0.3) {
        sparkUsed += 1;
        try {
          window.sessionStorage.setItem(SPARK_KEY, String(sparkUsed));
        } catch {
          // 隐私模式写不进去，预算只留在内存里。
        }
        const node = nodes[kind];
        const spot = travelers[kind]?.at ?? runtime[kind];
        spawnSparks(fxRef.current, spot.x + mascotSize() / 2, spot.y + 8, 3);
        if (node) {
          node.classList.add("is-sparkle");
          window.clearTimeout(runtime[kind].classTimer);
          runtime[kind].classTimer = window.setTimeout(
            () => node.classList.remove("is-sparkle"),
            1400,
          );
        }
        return;
      }
      const plan = ACT_PLAN[kind];
      const state = plan[actIndex[kind] % plan.length];
      actIndex[kind] += 1;
      poseFor(kind, state, ACT_EYES[state] ?? "open", 2200 + Math.random() * 1100);
      if (state === "juggle") {
        spawnSparks(fxRef.current, runtime[kind].x + mascotSize() / 2, runtime[kind].y + 8, 2);
      }
    };

    const scheduleAct = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.actTimer);
      rt.actTimer = window.setTimeout(
        () => {
          if (canAct(kind)) performAct(kind);
          scheduleAct(kind);
        },
        ACT_MIN_MS + Math.random() * (ACT_MAX_MS - ACT_MIN_MS),
      );
    };

    // 眨眼 2.4-6s 随机一次，造型层按 .is-blink 把眼睛压扁 90ms。
    const scheduleBlink = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.blinkTimer);
      rt.blinkTimer = window.setTimeout(
        () => {
          const node = nodes[kind];
          if (!disposed && node && !isStatic()) {
            node.classList.add("is-blink");
            window.clearTimeout(rt.blinkClearTimer);
            rt.blinkClearTimer = window.setTimeout(
              () => node.classList.remove("is-blink"),
              120,
            );
          }
          scheduleBlink(kind);
        },
        BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS),
      );
    };

    // 微扫视 1.5-4s 一次，眼球 ±1-2px，别让眼神死盯一点。
    const scheduleSaccade = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.saccadeTimer);
      rt.saccadeTimer = window.setTimeout(
        () => {
          if (!disposed && !isStatic()) {
            lookAt(
              kind,
              (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random()),
              (Math.random() - 0.5) * 2,
            );
          }
          scheduleSaccade(kind);
        },
        SACCADE_MIN_MS + Math.random() * (SACCADE_MAX_MS - SACCADE_MIN_MS),
      );
    };

    const otherTwo = (): [Kind, Kind] => {
      const shuffled = [...KINDS].sort(() => Math.random() - 0.5);
      return [shuffled[0], shuffled[1]] as [Kind, Kind];
    };

    const onScreen = (kind: Kind) => {
      const node = nodes[kind];
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const { vh } = viewport();
      return rect.bottom > 0 && rect.top < vh;
    };

    const canInteract = () =>
      !disposed &&
      !interacting &&
      !enteringDetail &&
      !sleeping &&
      performance.now() >= interactionBlockedUntil &&
      interactionCount < INTERACTION_SESSION_MAX &&
      document.visibilityState === "visible" &&
      !editing() &&
      KINDS.every(onScreen);

    const alive = (gen: number) => !disposed && gen === interactionGen;

    const resetPoses = () => {
      for (const kind of KINDS) poseFor(kind, IDLE_POSE.state, IDLE_POSE.eyes);
    };

    const bumpInteractionCount = () => {
      interactionCount += 1;
      try {
        window.sessionStorage.setItem(INTERACTION_KEY, String(interactionCount));
      } catch {
        // 隐私模式下 sessionStorage 不可写，计数留在内存里就够了。
      }
    };

    const endInteraction = (gen: number) => {
      if (!alive(gen)) return;
      interactionGen += 1;
      interacting = false;
      bumpInteractionCount();
      resetPoses();
      scheduleInteraction();
      // 互动期间发生的 resize / 视口变化压在这里补算，别等下一次滚动。
      scheduleReconcile();
    };

    // 点击任意一只立即结束互动：让出编排，三只 hop 回各自的位置。
    const skipInteraction = () => {
      if (!interacting) return;
      interactionGen += 1;
      interacting = false;
      bumpInteractionCount();
      resetPoses();
      for (const kind of KINDS) {
        hideBubble(kind, 0);
        sendHome(kind, true);
      }
      scheduleInteraction();
      scheduleReconcile();
    };

    // 碰头问好：一只 hop 过去，双双 squash，各冒一句话，再 hop 回原位。
    const greet = (gen: number) => {
      const [a, b] = otherTwo();
      const size = mascotSize();
      const home = { x: runtime[a].x, y: runtime[a].y };
      const spot = clampSpot(runtime[b].x - size - 8, runtime[b].y, size);
      moveTo(a, spot, {
        hop: true,
        onLand: () => {
          if (!alive(gen)) return;
          squash(a);
          squash(b);
          showBubble(a, pick(GREET_LINES[a]), 2200);
          showBubble(b, pick(GREET_LINES[b]), 2200);
          window.setTimeout(() => {
            if (!alive(gen)) return;
            moveTo(a, home, { onDone: () => endInteraction(gen) });
          }, 1700);
        },
      });
    };

    // 打架：互推两轮 → 弹开 → 再撞一次 → 和好碰头撒星。全程 hop，不瞬移。
    const fight = (gen: number) => {
      const [a, b] = otherTwo();
      const size = mascotSize();
      const homeA = { x: runtime[a].x, y: runtime[a].y };
      const homeB = { x: runtime[b].x, y: runtime[b].y };
      const baseY = Math.min(homeA.y, homeB.y);
      const midX = (homeA.x + homeB.x) / 2;
      const center = clampSpot(midX - size / 2, baseY, size);
      const gap = size + 4;
      const contactA = clampSpot(center.x - gap, center.y, size);
      const contactB = clampSpot(center.x + gap, center.y, size);
      const apartA = clampSpot(center.x - gap * 2.6, center.y, size);
      const apartB = clampSpot(center.x + gap * 2.6, center.y, size);
      const meetA = clampSpot(center.x - gap * 0.9, center.y, size);
      const meetB = clampSpot(center.x + gap * 0.9, center.y, size);

      const rush = (left: MascotPoint, right: MascotPoint, done: () => void) => {
        let landed = 0;
        const onLand = () => {
          landed += 1;
          if (landed < 2 || !alive(gen)) return;
          done();
        };
        moveTo(a, left, { hop: true, onLand });
        moveTo(b, right, { hop: true, onLand });
      };

      const clash = (next: () => void) => {
        rush(contactA, contactB, () => {
          squash(a);
          squash(b);
          spawnSparks(fxRef.current, center.x + size / 2, center.y + size * 0.55, 2);
          showBubble(a, pick(FIGHT_LINES[a]), 2000);
          showBubble(b, pick(FIGHT_LINES[b]), 2000);
          window.setTimeout(() => {
            if (!alive(gen)) return;
            next();
          }, 950);
        });
      };

      // 第一轮：冲过去撞一下。
      clash(() => {
        // 双方弹开，喘口气。
        rush(apartA, apartB, () => {
          if (!alive(gen)) return;
          window.setTimeout(() => {
            if (!alive(gen)) return;
            // 第二轮：再撞一次，各自再回一句。
            clash(() => {
              // 和好：碰头 squash + 星星。
              rush(meetA, meetB, () => {
                squash(a);
                squash(b);
                spawnSparks(fxRef.current, center.x + size / 2, center.y + 6, 3);
                showBubble(a, pick(MAKE_UP_LINES[a]), 2200);
                showBubble(b, pick(MAKE_UP_LINES[b]), 2200);
                window.setTimeout(() => {
                  if (!alive(gen)) return;
                  let back = 0;
                  const done = () => {
                    back += 1;
                    if (back === 2) endInteraction(gen);
                  };
                  moveTo(a, homeA, { onDone: done });
                  moveTo(b, homeB, { onDone: done });
                }, 1400);
              });
            });
          }, 760);
        });
      });
    };

    // Grok 巡场：小黑球绕两只一圈，两条视线跟着它转，落地撒两颗星。
    const grokPatrol = (gen: number) => {
      const center = {
        x: (runtime.claude.x + runtime.gpt.x) / 2,
        y: (runtime.claude.y + runtime.gpt.y) / 2,
      };
      const size = mascotSize();
      const radiusX = Math.min(220, Math.abs(runtime.grok.x - center.x) * 0.8 + 90);
      const radiusY = 46;
      const points = [0, 1, 2, 3].map((index) => {
        const angle = (index / 4) * Math.PI * 2 - Math.PI / 2;
        return clampSpot(
          center.x + Math.cos(angle) * radiusX,
          center.y + Math.sin(angle) * radiusY,
          size,
        );
      });
      const home = { x: runtime.grok.x, y: runtime.grok.y };

      const watch = (targetX: number | null) => {
        for (const kind of ["claude", "gpt"] as const) {
          if (targetX === null) {
            lookAt(kind, 0, 0);
            continue;
          }
          lookAt(kind, Math.sign(targetX - runtime[kind].x) * 2, 0);
        }
      };

      const step = (index: number) => {
        if (!alive(gen)) return;
        const point = points[index];
        watch(point.x + size / 2);
        moveTo("grok", point, {
          drift: true,
          onLand: () => {
            if (!alive(gen)) return;
            if (index === 1 || index === 3) {
              spawnSparks(fxRef.current, point.x + size / 2, point.y + 10, 1);
            }
            if (index === points.length - 1) {
              watch(null);
              moveTo("grok", home, { onDone: () => endInteraction(gen) });
              return;
            }
            step(index + 1);
          },
        });
      };

      showBubble("grok", "巡场中～", 2000);
      step(0);
    };

    // 戳觉：一只打盹，另一只 hop 过去戳一下，惊醒跳起再 「!」。
    const poke = (gen: number) => {
      const [sleeper, poker] = otherTwo();
      const size = mascotSize();
      poseFor(sleeper, "sleep", "closed");
      showBubble(sleeper, "Zzz…", 1800);
      window.setTimeout(() => {
        if (!alive(gen)) return;
        const home = { x: runtime[poker].x, y: runtime[poker].y };
        const spot = clampSpot(runtime[sleeper].x + size + 6, runtime[sleeper].y, size);
        moveTo(poker, spot, {
          hop: true,
          onLand: () => {
            if (!alive(gen)) return;
            poseFor(sleeper, "alert", "wide");
            squash(sleeper);
            showBubble(sleeper, "！", 1400);
            showBubble(poker, "嘿，别睡～", 1800);
            window.setTimeout(() => {
              if (!alive(gen)) return;
              poseFor(sleeper, "idle", "open");
              moveTo(poker, home, { onDone: () => endInteraction(gen) });
            }, 1500);
          },
        });
      }, 1100);
    };

    // 合影庆祝：三只同屏各撒星星（下单成功后 30s 内优先）。
    const photo = (gen: number) => {
      const size = mascotSize();
      for (const kind of KINDS) {
        poseFor(kind, "cheer", "happy");
        showBubble(kind, PHOTO_LINES[kind], 2400);
        squash(kind);
        spawnSparks(fxRef.current, runtime[kind].x + size / 2, runtime[kind].y + 6, 2);
      }
      window.setTimeout(() => {
        if (!alive(gen)) return;
        endInteraction(gen);
      }, 2600);
    };

    const runInteraction = () => {
      interactionGen += 1;
      const gen = interactionGen;
      interacting = true;
      // 剧目一开演就把还没冒头的带路气泡撤掉，别让按钮打断打闹。
      for (const kind of KINDS) cancelGuide(kind);
      if (isStatic()) {
        // reduced-motion / 移动端：只留同时冒出的气泡对，不做位移。
        const [a, b] = otherTwo();
        showBubble(a, pick(GREET_LINES[a]), 2200);
        showBubble(b, pick(GREET_LINES[b]), 2200);
        endInteraction(gen);
        return;
      }
      // 每会话第一场固定「碰头问好」，让客户先看见三只会打招呼。
      if (interactionCount === 0) {
        greet(gen);
        return;
      }
      // 下单成功后 30s 内优先拍合影。
      if (Date.now() - paidTimestamp() < PAID_WINDOW_MS && Math.random() < 0.7) {
        photo(gen);
        return;
      }
      const roll = Math.random();
      if (roll < 0.3) fight(gen);
      else if (roll < 0.52) greet(gen);
      else if (roll < 0.76) grokPatrol(gen);
      else poke(gen);
    };

    const scheduleInteraction = (delay?: number) => {
      window.clearTimeout(interactionTimer);
      if (interactionCount >= INTERACTION_SESSION_MAX) return;
      const wait =
        delay ??
        (interactionCount === 0
          ? FIRST_INTERACTION_MIN_MS +
            Math.random() * (FIRST_INTERACTION_MAX_MS - FIRST_INTERACTION_MIN_MS)
          : INTERACTION_MIN_MS + Math.random() * (INTERACTION_MAX_MS - INTERACTION_MIN_MS));
      interactionTimer = window.setTimeout(
        () => {
          if (disposed) return;
          if (!canInteract()) {
            // 客户在打字 / 页面在后台：不消耗场次，过几秒再试。
            scheduleInteraction(INTERACTION_RETRY_MS);
            return;
          }
          runInteraction();
        },
        wait,
      );
    };

    // 2 分钟没人动 → 打盹，任何操作回来先伸个懒腰。
    const doze = () => {
      if (disposed || isStatic() || interacting) {
        resetIdle();
        return;
      }
      sleeping = true;
      for (const kind of KINDS) poseFor(kind, "sleep", "closed");
    };

    const wakeUp = () => {
      if (!sleeping) return;
      sleeping = false;
      for (const kind of KINDS) {
        poseFor(kind, "idle", "open");
        const stance = stanceRef.current[kind];
        if (!stance) continue;
        stance.classList.add("is-wake");
        window.setTimeout(() => stance.classList.remove("is-wake"), 960);
      }
      showBubble("gpt", "睡饱啦～", 2000);
    };

    const resetIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(doze, DOZE_MS);
    };

    const onActivity = () => {
      const now = performance.now();
      // 指针移动很密，节流到 1s 一次，够醒来也够重新计时。
      if (now - lastActivity < 1000) return;
      lastActivity = now;
      wakeUp();
      resetIdle();
    };

    const scheduleReconcile = (delay = 180) => {
      window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = 0;
        reconcile();
      }, delay);
    };

    const visibility = new Map<Element, number>();
    const observed = new Set<Element>();
    let observeRetries = 0;

    /**
     * 卡片集合是活的：换页 / 换分类 / 搜索后 React 会换掉整批 <a>，
     * 老元素继续被观察就会让新卡永远认领不到，所以每次 reconcile 先对齐一遍。
     */
    const syncCards = () => {
      const live = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
      const liveSet = new Set<Element>(live);
      for (const card of live) {
        if (observed.has(card)) continue;
        observer?.observe(card);
        observed.add(card);
      }
      for (const card of observed) {
        if (liveSet.has(card)) continue;
        observer?.unobserve(card);
        observed.delete(card);
        visibility.delete(card);
        claims.delete(card);
      }
    };

    // 详情页守位：入场结束后只做轻微归位，不抢镜。
    const holdDetail = () => {
      for (const kind of KINDS) {
        if (travelers[kind]?.busy || runtime[kind].hovering) continue;
        const spot = detailSpot(kind);
        if (Math.abs(spot.x - runtime[kind].x) > 28 || Math.abs(spot.y - runtime[kind].y) > 28) {
          moveTo(kind, spot);
        }
      }
    };

    const reconcile = () => {
      if (disposed || isStatic() || interacting || enteringDetail) return;
      if (onDetail()) {
        holdDetail();
        return;
      }
      readBuyBar();
      syncCards();
      // 刚换上来的一批卡片还没上报可见比例时先别急着让角色回家，
      // 等一两拍再认领；重试有上限，卡片全在折叠线以下时不会空转。
      const anyVisible = Array.from(visibility.values()).some((ratio) => ratio > 0);
      if (!anyVisible && observed.size > 0 && observeRetries < 2) {
        observeRetries += 1;
        scheduleReconcile(260);
        return;
      }
      observeRetries = 0;
      // 布局各量一次再排序，比较器里不反复读 getBoundingClientRect。
      const ordered = Array.from(visibility.entries())
        .filter(([card, ratio]) => ratio > 0 && card.isConnected)
        .map(([card]) => {
          const el = card as HTMLElement;
          return { el, rect: el.getBoundingClientRect() };
        })
        .sort((a, b) => a.rect.top - b.rect.top);

      const assignment = new Map<Kind, { el: HTMLElement; rect: DOMRect } | null>();
      for (const kind of KINDS) {
        const next =
          ordered.find((card) => {
            const owner = claims.get(card.el);
            return cardKinds(card.el).includes(kind) && (!owner || owner === kind);
          }) ?? null;
        assignment.set(kind, next);
      }

      // 落点统一规划：按 KINDS 顺序给每只挑一个互不重叠的侧位，
      // 后面的那只避开前面已经定下的点，也不会把别人挤到邻卡去。
      const planned = new Map<Kind, MascotPoint | null>();
      const taken: MascotPoint[] = [];
      for (const kind of KINDS) {
        const card = assignment.get(kind) ?? null;
        if (!card) {
          planned.set(kind, null);
          continue;
        }
        const occupied = taken.concat(
          KINDS.filter((other) => other !== kind).map((other) => ({
            x: runtime[other].x,
            y: runtime[other].y,
          })),
        );
        const blockers = ordered
          .filter((entry) => entry.el !== card.el)
          .map((entry) => entry.rect);
        const spot = spotNearCard(kind, card.rect, occupied, blockers);
        runtime[kind].offsetY = spot.y - card.rect.top;
        taken.push(spot);
        planned.set(kind, spot);
      }

      for (const kind of KINDS) {
        const rt = runtime[kind];
        const card = assignment.get(kind) ?? null;
        const next = card?.el ?? null;
        const spot = planned.get(kind) ?? null;
        if (!next || !spot) {
          if (rt.target) {
            claims.delete(rt.target);
            rt.target = null;
            sendHome(kind, true);
          }
          continue;
        }
        if (rt.target === next) {
          // 同一张卡，但落点被新来的那只占了：跟着挪一格，不换个卡站。
          if (
            !rt.hovering &&
            !travelers[kind]?.busy &&
            (Math.abs(spot.x - rt.x) > 12 || Math.abs(spot.y - rt.y) > 12)
          ) {
            moveTo(kind, spot);
          }
          continue;
        }
        if (rt.hovering) continue;
        if (rt.target) claims.delete(rt.target);
        claims.set(next, kind);
        rt.target = next;
        jumpToCard(kind, next, spot);
      }
    };

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              let changed = false;
              for (const entry of entries) {
                const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
                if (visibility.get(entry.target) !== ratio) {
                  visibility.set(entry.target, ratio);
                  changed = true;
                }
              }
              if (changed) scheduleReconcile();
            },
            { threshold: [0, 0.2, 0.6, 1], rootMargin: "-88px 0px -18% 0px" },
          );

    const followTarget = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        if (disposed || isStatic() || interacting || enteringDetail || onDetail()) return;
        const { minY, maxY } = limits();
        for (const kind of KINDS) {
          const rt = runtime[kind];
          if (!rt.target || rt.hovering || travelers[kind]?.busy) continue;
          // 竖向滚动只改 y：沿着认领时记下的卡片内偏移走，不重新选边，
          // 既不会滑到邻卡，也省掉每帧的风水计算。
          const rect = rt.target.getBoundingClientRect();
          const y = Math.min(Math.max(rect.top + rt.offsetY, minY), maxY);
          if (Math.abs(y - rt.y) > 24) moveTo(kind, { x: rt.x, y });
        }
      });
    };

    // 滚动结束后再按新的视口重算一次，滚动中只做轻量跟随。
    const onScroll = () => {
      onActivity();
      // 带按钮的气泡一滚就收：按钮跟着页面跑会跟内容错位。
      for (const kind of KINDS) {
        if (actionRef.current[kind]) hideBubble(kind, 0);
      }
      followTarget();
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        readBuyBar();
        followTarget();
        scheduleReconcile(140);
      }, 160);
    };

    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        // 互动编排靠 onLand 串动作，重排时别把正在走的位移掐断。
        if (disposed || interacting) return;
        enteringDetail = false;
        readBottomInset();
        readBuyBar();
        for (const kind of KINDS) {
          const rt = runtime[kind];
          if (rt.target) claims.delete(rt.target);
          rt.target = null;
        }
        for (const kind of KINDS) sendHome(kind, false);
        followTarget();
        scheduleReconcile(120);
      }, 160);
    };

    const onMotionChange = () => {
      if (interacting) return;
      if (reducedQuery.matches) {
        for (const kind of KINDS) {
          const rt = runtime[kind];
          if (rt.target) claims.delete(rt.target);
          rt.target = null;
          sendHome(kind, false);
        }
      }
      scheduleReconcile(120);
    };

    // 下单成功由支付动画那边广播；记下时间点，30s 内桌宠拍合影。
    const onPaid = () => {
      try {
        window.sessionStorage.setItem(PAID_KEY, String(Date.now()));
      } catch {
        // 写不进去就退回普通互动。
      }
    };

    const heroCard = (kind: Kind): HTMLElement | null => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
      return cards.find((card) => cardKinds(card).includes(kind)) ?? null;
    };

    const activate = (kind: Kind) => {
      // 互动中点击任意一只：立刻收场，三只 hop 回原位。
      if (interacting) {
        skipInteraction();
        return;
      }
      // 客户自己上手了：撤掉还没冒头的那次追问，别待会儿又补一句。
      cancelGuide(kind);
      const rt = runtime[kind];
      // 正在位移时不插播蹦跳，避免两段 squash 动画打架。
      if (!travelers[kind]?.busy) travelers[kind]?.bounce();
      if (onDetail()) {
        // 详情页没有卡片可跳：把客户带到下单面板前。
        showBubble(kind, `${DETAIL_LINES[kind]}，下单在这边`, 2600);
        document.querySelector<HTMLElement>(".shop-buy-panel")?.scrollIntoView({
          behavior: reducedQuery.matches ? "auto" : "smooth",
          block: "center",
        });
        return;
      }
      const card = rt.target ?? heroCard(kind);
      // 移动端和减少动效的静态模式不走卡片认领，点桌宠是客户唯一的入口：
      // 这里也问一句要不要带路，配额和认领后那一次共用。
      // 别的桌宠按钮还挂着时 runGuide 会拒掉：只留一句普通台词，也不再滚页面，
      // 免得把人家那颗按钮连带收掉。没货的卡片同样不带路，只换一句柔和台词。
      const otherBusy = otherActionUp(kind);
      const inStock = card ? cardInStock(card) : true;
      const href = card?.getAttribute("href") ?? "";
      const guided = href.startsWith("/") && inStock ? runGuide(kind, href, card) : false;
      if (!guided) {
        const line = !card
          ? pick(kind === "grok" ? GROK_ROAM_LINES : FALLBACK_LINES)
          : inStock
            ? CLICK_LINE
            : NO_STOCK_LINE;
        showBubble(kind, line, 2600);
        if (otherBusy) return;
        // 点一下就把商品带到眼前；静态模式直接跳，不要长距离平滑滚动。
        // 已经弹出带路按钮时不再滚：滚动会把刚冒出来的按钮收掉。
        card?.scrollIntoView({
          behavior: reducedQuery.matches ? "auto" : "smooth",
          block: "center",
        });
      }
    };

    const hover = (kind: Kind, on: boolean) => {
      const rt = runtime[kind];
      rt.hovering = on;
      // 带按钮的气泡挂着时，鼠标扫过桌宠不抢话，也不替客户把按钮收掉：
      // 客户多半是奔着那颗按钮来的。
      if (actionRef.current[kind]) {
        if (!on) scheduleReconcile(320);
        return;
      }
      if (on) {
        const card = rt.target ?? heroCard(kind);
        const info = card ? readCard(card) : null;
        showBubble(
          kind,
          info
            ? pick(bubbleLines(info))
            : pick(kind === "grok" ? GROK_ROAM_LINES : FALLBACK_LINES),
          4200,
        );
      } else {
        hideBubble(kind, 700);
        scheduleReconcile(320);
      }
    };

    apiRef.current = { activate, hover };

    /**
     * 详情页入场：三只先挪到屏幕左缘外，再间隔 150ms 一只接一只沿弧线 hop 进来，
     * 落到商品卡左栏的守位上，各自冒一句商品介绍。
     */
    const enterDetail = (stored: Record<Kind, StoredSpot> | null) => {
      enteringDetail = true;
      interactionBlockedUntil = performance.now() + 14_000;
      KINDS.forEach((kind, index) => {
        const spot = detailSpot(kind);
        const { minY, maxY } = limits();
        const startY = clamp(stored?.[kind]?.y ?? spot.y, minY, maxY);
        snapTo(kind, { x: -(mascotSize() + 26), y: startY });
        window.setTimeout(() => {
          if (disposed) return;
          if (isStatic()) {
            snapTo(kind, spot);
            detailIntro(kind);
            if (index === KINDS.length - 1) enteringDetail = false;
            return;
          }
          moveTo(kind, spot, {
            hop: true,
            onDone: () => {
              if (disposed) return;
              detailIntro(kind);
              if (index === KINDS.length - 1) {
                enteringDetail = false;
                scheduleReconcile(200);
              }
            },
          });
        }, ENTRY_STAGGER_MS * index + 40);
      });
      // 兜底：入场中途被 resize 拦住时 onDone 不会来，别把认领和互动一直锁着。
      window.setTimeout(() => {
        if (disposed) return;
        enteringDetail = false;
        scheduleReconcile(200);
      }, ENTRY_STAGGER_MS * KINDS.length + 4200);
    };

    // 换页重绑时先把姿态收回待机，别让上一页被打断的 Zzz / 惊吓跨页残留。
    for (const kind of KINDS) setPose(kind, IDLE_POSE);
    for (const kind of KINDS) nodes[kind]?.classList.add("is-ready");

    const stored = readStoredSpots();
    const previousPath = readStoredPath();
    writeStoredPath(pathname);

    if (onDetail() && previousPath !== pathname) {
      enterDetail(stored);
    } else if (!onDetail() && isDetailPath(previousPath)) {
      // 从详情页回到列表：先落回刚才的坐标，再让认领逻辑 hop 过去，中间不闪。
      for (const kind of KINDS) {
        const point = stored?.[kind] ?? runtime[kind];
        snapTo(kind, clampSpot(point.x, point.y, mascotSize()));
      }
      scheduleReconcile(360);
    } else if (stored) {
      // 整页刷新：坐标接着上次的站，不从头归位。
      // 姿态不跟着坐标恢复：离开前哪怕正打盹，回来也是上面重置好的 idle，
      // 重新计满 2 分钟无操作才打盹，不会跨页一进来就睡着。
      for (const kind of KINDS) {
        snapTo(kind, clampSpot(stored[kind].x, stored[kind].y, mascotSize()));
      }
      scheduleReconcile(400);
    } else {
      for (const kind of KINDS) sendHome(kind, false);
    }

    for (const kind of KINDS) {
      schedulePatrol(kind);
      scheduleAct(kind);
      scheduleBlink(kind);
      scheduleSaccade(kind);
    }
    scheduleInteraction();
    resetIdle();

    // 点气泡以外的地方就把带按钮的气泡收掉，不挡客户接下来的操作。
    const onDocPointerDown = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest(".shop-mascot-bubble")) return;
      for (const kind of KINDS) {
        if (actionRef.current[kind]) hideBubble(kind, 0);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);

    // 带按钮的气泡挂起时，Escape 只收这一颗按钮气泡；没有按钮就完全不管，
    // 也不 preventDefault：输入框、弹层自己的 Escape 语义不能被桌宠抢走。
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const kind of KINDS) {
        if (actionRef.current[kind]) hideBubble(kind, 0);
      }
    };
    document.addEventListener("keydown", onDocKeyDown);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("cokeai:order-paid", onPaid);
    reducedQuery.addEventListener("change", onMotionChange);
    mobileQuery.addEventListener("change", onResize);

    // 换分类 / 搜索 / 懒加载都会换掉卡片节点，主容器一变动就重新对一遍账。
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => scheduleReconcile(320));
    const cardHost = document.querySelector("main") ?? document.body;
    mutations?.observe(cardHost, { childList: true, subtree: true });

    // 首屏已有商品卡在视野里时，不必等滚动才联动。
    scheduleReconcile(400);

    return () => {
      disposed = true;
      apiRef.current = null;
      observer?.disconnect();
      mutations?.disconnect();
      // 离开这一页前记下坐标，跨页回来 / 刷新时接着站。
      // 只记坐标：lastPose 里的睡眠 / 剧目状态是本页的临时演出，不写进快照。
      const snapshot = {} as Record<Kind, StoredSpot>;
      for (const kind of KINDS) {
        snapshot[kind] = {
          x: Math.round(runtime[kind].x),
          y: Math.round(runtime[kind].y),
        };
      }
      writeStoredSpots(snapshot);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeyDown);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("cokeai:order-paid", onPaid);
      reducedQuery.removeEventListener("change", onMotionChange);
      mobileQuery.removeEventListener("change", onResize);
      window.clearTimeout(reconcileTimer);
      window.clearTimeout(resizeTimer);
      window.clearTimeout(scrollTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(interactionTimer);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      for (const kind of KINDS) {
        const rt = runtime[kind];
        window.clearTimeout(rt.patrolTimer);
        window.clearTimeout(rt.actTimer);
        window.clearTimeout(rt.blinkTimer);
        window.clearTimeout(rt.blinkClearTimer);
        window.clearTimeout(rt.saccadeTimer);
        window.clearTimeout(rt.poseTimer);
        window.clearTimeout(rt.classTimer);
        travelers[kind]?.cancel();
        nodes[kind]?.classList.remove(
          "is-ready",
          "is-blink",
          "is-sparkle",
        );
        liftRef.current[kind]?.classList.remove("is-hop", "is-drift");
        stanceRef.current[kind]?.classList.remove(
          "is-air",
          "is-crouch",
          "is-land",
          "is-bounce",
          "is-wake",
        );
      }
      for (const kind of KINDS) window.clearTimeout(bubbleTimers.current[kind]);
      // 换页时把气泡连同按钮一起收干净：旧气泡的收起定时器刚被清掉，
      // 不主动清状态的话它会一直挂在上一页的位置上。
      for (const kind of KINDS) {
        window.clearTimeout(guideTimers.current[kind]);
        guideTimers.current[kind] = 0;
        actionRef.current[kind] = null;
        bubbleTextRef.current[kind] = null;
      }
      setBubbles({ claude: null, gpt: null, grok: null });
    };
    // 分页 / 进商品详情 / 回列表都是 next/link 的客户端导航，组件实例不会重建：
    // 依赖 pathname 让观察器和新一页的入场编排跟着重绑。
    // 只切 query 的分类和搜索由 MutationObserver 里的卡片同步兜住。
  }, [showBubble, hideBubble, pathname, hidden]);

  // grok 的视线跟鼠标：弹簧插值，页面隐藏或静止时停掉 rAF。
  useEffect(() => {
    if (hidden) return;
    const node = nodesRef.current.grok;
    if (!node) return;
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    let frame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let rect = node.getBoundingClientRect();
    let rectAt = 0;

    const write = () => {
      node.style.setProperty("--m-eye-x", `${currentX.toFixed(2)}px`);
      node.style.setProperty("--m-eye-y", `${currentY.toFixed(2)}px`);
    };

    const spring = () => {
      frame = 0;
      currentX += (targetX - currentX) * 0.22;
      currentY += (targetY - currentY) * 0.22;
      write();
      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        frame = window.requestAnimationFrame(spring);
      }
    };

    const onMove = (event: PointerEvent) => {
      if (reducedQuery.matches || mobileQuery.matches || document.hidden) return;
      const now = performance.now();
      // 位置每 200ms 最多读一次，指针移动不碰布局。
      if (now - rectAt > 200) {
        rectAt = now;
        rect = node.getBoundingClientRect();
      }
      const reach = Math.max(120, Math.min(420, window.innerHeight * 0.45));
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      targetX = Math.min(3, Math.max(-3, (dx / reach) * 3));
      targetY = Math.min(3, Math.max(-3, (dy / reach) * 3));
      if (!frame && !document.hidden) frame = window.requestAnimationFrame(spring);
    };

    const onVisibility = () => {
      if (!document.hidden || !frame) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame) window.cancelAnimationFrame(frame);
      node.style.setProperty("--m-eye-x", "0px");
      node.style.setProperty("--m-eye-y", "0px");
    };
  }, [hidden]);

  // 气泡可能顶到视口边缘：先量出实际位置往内推，推好了再挂 is-visible 上屏，
  // 不然气泡会先在屏幕外出现再横跳一下。
  useEffect(() => {
    if (hidden) return;
    for (const kind of KINDS) {
      if (!bubbles[kind]) continue;
      const node = nodesRef.current[kind];
      const bubble = node?.querySelector<HTMLElement>(".shop-mascot-bubble");
      if (!bubble) continue;
      bubble.style.setProperty("--bubble-shift", "0px");
      const rect = bubble.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      let shift = 0;
      if (rect.left < BUBBLE_EDGE) shift = BUBBLE_EDGE - rect.left;
      else if (rect.right > vw - BUBBLE_EDGE) shift = vw - BUBBLE_EDGE - rect.right;
      bubble.style.setProperty("--bubble-shift", `${Math.round(shift)}px`);
      bubble.classList.add("is-visible");
    }
  }, [bubbles, hidden]);

  const setNode = (kind: Kind) => (el: HTMLDivElement | null) => {
    nodesRef.current[kind] = el;
  };
  const setLift = (kind: Kind) => (el: HTMLSpanElement | null) => {
    liftRef.current[kind] = el;
  };
  const setStance = (kind: Kind) => (el: HTMLSpanElement | null) => {
    stanceRef.current[kind] = el;
  };

  if (hidden) return null;

  /** 气泡按钮：跳详情走客户端路由，详情页的下单提示只滚页面。 */
  const runAction = (kind: Kind, action: BubbleAction) => {
    hideBubble(kind, 0);
    if ("href" in action) {
      router.push(action.href);
      return;
    }
    const target = buyHintTarget();
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };

  const mascot = (kind: Kind) => {
    const bubble = bubbles[kind];
    const action = bubble?.action ?? null;
    return (
      <div
        key={kind}
        ref={setNode(kind)}
        className={`shop-mascot shop-mascot-${kind}`}
        data-state={poses[kind].state}
        role="button"
        tabIndex={0}
        aria-label={LABELS[kind]}
        onClick={() => apiRef.current?.activate(kind)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            apiRef.current?.activate(kind);
          }
        }}
        onMouseEnter={() => apiRef.current?.hover(kind, true)}
        onMouseLeave={() => apiRef.current?.hover(kind, false)}
      >
        <span ref={setLift(kind)} className="shop-mascot-lift" aria-hidden="true">
          <span ref={setStance(kind)} className="shop-mascot-stance">
            <span className="shop-mascot-breathe">
              {/* 剧目状态走字符串透传：P1 的类型已含 type/build/music/juggle，
                  两边的落地顺序不同时这层 cast 让消费端先编译通过。 */}
              <ShopMascotIdlePose
                kind={kind}
                eyes={poses[kind].eyes}
                state={poses[kind].state as ShopMascotState}
              />
            </span>
          </span>
        </span>
        <span className="shop-mascot-think" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="shop-mascot-zzz" aria-hidden="true">
          <span>Z</span>
          <span>z</span>
          <span>z</span>
        </span>
        {bubble ? (
          <span
            className={action ? "shop-mascot-bubble has-act" : "shop-mascot-bubble"}
            // 纯装饰的气泡对读屏隐藏；带按钮的要能读出来，按钮才是有语义的。
            aria-hidden={action ? undefined : true}
            // 气泡浮在卡片上方，带按钮时整块吃掉点击，别让点空处穿透到下面的卡片。
            onClick={action ? (event) => event.stopPropagation() : undefined}
          >
            {bubble.text}
            {action ? (
              <button
                type="button"
                className="shop-mascot-bubble-act"
                onClick={(event) => {
                  // 按钮长在桌宠的点击区里：这一下只归按钮，不触发底下的桌宠动作。
                  event.preventDefault();
                  event.stopPropagation();
                  runAction(kind, action);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {action.label}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {KINDS.map((kind) => mascot(kind))}
      <div ref={fxRef} className="shop-mascot-fx" aria-hidden="true" />
    </>
  );
}
