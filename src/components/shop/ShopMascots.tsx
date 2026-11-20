"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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
const PATROL_MIN_MS = 9000;
const PATROL_MAX_MS = 15000;
const ACT_MIN_MS = 7000;
const ACT_MAX_MS = 13500;
const BLINK_MIN_MS = 2400;
const BLINK_MAX_MS = 6000;
const SACCADE_MIN_MS = 1500;
const SACCADE_MAX_MS = 4000;
const DOZE_MS = 120_000;
const INTERACTION_MIN_MS = 70_000;
const INTERACTION_MAX_MS = 110_000;
const INTERACTION_SESSION_MAX = 6;
const SPARK_BUDGET = 2;
const INTERACTION_KEY = "cokeai:mascot-interactions";
const SPARK_KEY = "cokeai:mascot-sparkles";
const PAID_KEY = "cokeai:shop-paid-at";
const PAID_WINDOW_MS = 30_000;
const CARD_SELECTOR = "a.shop-row, a.shop-product-card";

/** 气泡离视口左右边缘至少留这么多，量出来再位移。 */
type CardInfo = {
  name: string;
  price: string | null;
  warranty: string | null;
  sales: string | null;
};

type Pose = { state: ShopMascotState; eyes: ShopMascotEyes };

const IDLE_POSE: Pose = { state: "idle", eyes: "open" };

type Runtime = {
  x: number;
  y: number;
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

const LABELS: Record<Kind, string> = {
  claude: "星芒侠：带你看 Claude 商品",
  gpt: "云宝：带你看 ChatGPT 商品",
  grok: "小黑球：带你看 Grok 商品",
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

/** 商品卡没有 data-category：按标题 + 品牌关键词归类，命中几个算几个。 */
function cardKinds(card: HTMLElement): Kind[] {
  const name = card.querySelector("h3")?.textContent || "";
  const brand =
    card.querySelector(".shop-row-kicker span, .shop-product-brand")?.textContent || "";
  const haystack = `${name} ${brand}`.toLowerCase();
  const kinds: Kind[] = [];
  if (/claude|anthropic/.test(haystack)) kinds.push("claude");
  if (/gpt|openai|chatgpt|codex/.test(haystack)) kinds.push("gpt");
  if (/grok|\bxai\b|x\.ai/.test(haystack)) kinds.push("grok");
  return kinds;
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

function newRuntime(): Runtime {
  return {
    x: 0,
    y: 0,
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
  const [bubbles, setBubbles] = useState<Record<Kind, string | null>>({
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
  const apiRef = useRef<{
    activate: (kind: Kind) => void;
    hover: (kind: Kind, on: boolean) => void;
  } | null>(null);

  const showBubble = useCallback((kind: Kind, text: string, hold = BUBBLE_HOLD_MS) => {
    window.clearTimeout(bubbleTimers.current[kind]);
    setBubbles((prev) => (prev[kind] === text ? prev : { ...prev, [kind]: text }));
    bubbleTimers.current[kind] = window.setTimeout(() => {
      setBubbles((prev) => ({ ...prev, [kind]: null }));
    }, hold);
  }, []);

  const hideBubble = useCallback((kind: Kind, delay = 0) => {
    window.clearTimeout(bubbleTimers.current[kind]);
    bubbleTimers.current[kind] = window.setTimeout(() => {
      setBubbles((prev) => ({ ...prev, [kind]: null }));
    }, delay);
  }, []);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    const runtime = runtimeRef.current;
    const nodes = nodesRef.current;
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const claims = new Map<Element, Kind>();
    let disposed = false;
    let reconcileTimer = 0;
    let resizeTimer = 0;
    let scrollFrame = 0;
    let scrollTimer = 0;
    let idleTimer = 0;
    let interactionTimer = 0;
    let interacting = false;
    let sleeping = false;
    let sparkUsed = 0;
    let lastActivity = 0;
    let interactionCount = 0;

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

    /** 角色下沿的可用最低点：留出边距和安全区。 */
    const bottomBaseline = () => {
      const { vh } = viewport();
      return Math.max(EDGE_GAP, vh - EDGE_GAP - mascotSize() - bottomInset);
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

    // 三只角色的待机位：星芒侠占左下、云宝居中、小黑球占右下。
    // 谁都不会压在右下角客服按钮上，也都会让开刘海屏底部的 Home 指示条。
    const idleSpot = (kind: Kind) => {
      const { vw } = viewport();
      const size = mascotSize();
      const { maxX } = limits();
      let x = EDGE_GAP;
      if (kind === "grok") x = maxX;
      else if (kind === "gpt") x = Math.round(vw / 2 - size / 2);
      x = Math.min(Math.max(x, EDGE_GAP), maxX);
      let y = bottomBaseline();
      const box = supportBox();
      if (box && hitsSupport(x, y, size)) y = Math.max(EDGE_GAP, box.top - size - 10);
      return { x, y };
    };

    const spotNearCard = (kind: Kind, rect: DOMRect) => {
      const size = mascotSize();
      const { minX, maxX, minY, maxY } = limits();
      // 星芒侠站卡片左侧的栏间留白，云宝和小黑球站右侧留白。
      const leftSpot = rect.left - size - 12;
      const rightSpot = Math.min(rect.right + 12, maxX);
      const leftOk = leftSpot >= EDGE_GAP - 4;
      const rightOk = rect.right + 12 <= maxX + 8;
      const wantLeft = kind === "claude";
      let x = rightSpot;
      if (wantLeft && leftOk) x = leftSpot;
      else if (!wantLeft && rightOk) x = rightSpot;
      else if (leftOk) x = leftSpot;
      x = Math.min(Math.max(x, minX), maxX);
      let y = rect.top + Math.min(72, Math.max(0, rect.height / 2 - size / 2));
      y = Math.min(Math.max(y, minY), maxY);
      for (const other of KINDS) {
        if (other === kind) continue;
        if (Math.hypot(x - runtime[other].x, y - runtime[other].y) < size + 12) {
          y = Math.min(Math.max(y - size - 16, minY), maxY);
        }
      }
      // 右下角的落点可能正好压住客服按钮，跟待机位一样往上让开。
      const box = supportBox();
      if (box && hitsSupport(x, y, size, box)) {
        y = Math.min(Math.max(box.top - size - 10, minY), maxY);
      }
      return { x, y };
    };

    const heroCard = (kind: Kind): HTMLElement | null => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
      return cards.find((card) => cardKinds(card).includes(kind)) ?? null;
    };

    const moveTo = (
      kind: Kind,
      spot: MascotPoint,
      options: { drift?: boolean; onLand?: (at: MascotPoint) => void; onDone?: (at: MascotPoint) => void } = {},
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
      const spot = idleSpot(kind);
      if (animate) moveTo(kind, spot);
      else snapTo(kind, spot);
    };

    const setPose = (kind: Kind, patch: Partial<Pose>) => {
      setPoses((prev) => {
        const current = prev[kind];
        const next = { ...current, ...patch };
        if (current.state === next.state && current.eyes === next.eyes) return prev;
        return { ...prev, [kind]: next };
      });
    };

    // 状态不硬切：表情 + 姿态整体换过去，hold 到了再回 idle，过渡交给造型层。
    const poseFor = (kind: Kind, state: ShopMascotState, eyes: ShopMascotEyes, hold = 0) => {
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

    const announceCard = (kind: Kind, card: HTMLElement) => {
      showBubble(kind, pick(bubbleLines(readCard(card))));
    };

    const jumpToCard = (kind: Kind, card: HTMLElement) => {
      const rect = card.getBoundingClientRect();
      const spot = spotNearCard(kind, rect);
      moveTo(kind, spot, { onLand: () => announceCard(kind, card) });
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
      !sleeping &&
      !interacting &&
      !runtime[kind].hovering &&
      !travelers[kind]?.busy;

    const schedulePatrol = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.patrolTimer);
      // 9-15s 一次抛物线巡逻跳；已认领商品时守在商品旁，不抢镜。
      rt.patrolTimer = window.setTimeout(
        () => {
          if (canAct(kind) && !rt.target) moveTo(kind, randomSpot(kind));
          schedulePatrol(kind);
        },
        PATROL_MIN_MS + Math.random() * (PATROL_MAX_MS - PATROL_MIN_MS),
      );
    };

    // 闲置剧目：思考泡 / 云宝敲字 / 星芒侠炫技（每会话最多两次）。
    const performAct = (kind: Kind) => {
      if (kind === "claude" && sparkUsed < SPARK_BUDGET) {
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
      if (kind === "gpt") {
        const node = nodes[kind];
        poseFor(kind, "think", "open", 1900);
        if (node) {
          node.classList.add("is-typing");
          window.clearTimeout(runtime[kind].classTimer);
          runtime[kind].classTimer = window.setTimeout(
            () => node.classList.remove("is-typing"),
            2000,
          );
        }
        return;
      }
      poseFor(kind, "think", "open", 2400 + Math.random() * 600);
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

    const editing = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
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
      !sleeping &&
      interactionCount < INTERACTION_SESSION_MAX &&
      document.visibilityState === "visible" &&
      !editing() &&
      KINDS.every(onScreen);

    const endInteraction = () => {
      interacting = false;
      interactionCount += 1;
      try {
        window.sessionStorage.setItem(INTERACTION_KEY, String(interactionCount));
      } catch {
        // 隐私模式下 sessionStorage 不可写，计数留在内存里就够了。
      }
      scheduleInteraction();
      // 互动期间发生的 resize / 视口变化压在这里补算，别等下一次滚动。
      scheduleReconcile();
    };

    // 碰头问好：一只 hop 过去，双双 squash，各冒一句话，再 hop 回原位。
    const greet = () => {
      const [a, b] = otherTwo();
      const size = mascotSize();
      const home = { x: runtime[a].x, y: runtime[a].y };
      const spot = clampSpot(runtime[b].x - size - 8, runtime[b].y, size);
      moveTo(a, spot, {
        onLand: () => {
          squash(a);
          squash(b);
          showBubble(a, pick(GREET_LINES[a]), 2200);
          showBubble(b, pick(GREET_LINES[b]), 2200);
          window.setTimeout(() => {
            if (disposed) return;
            moveTo(a, home, { onDone: endInteraction });
          }, 1700);
        },
      });
    };

    // Grok 巡场：小黑球绕两只一圈，两条视线跟着它转，落地撒两颗星。
    const grokPatrol = () => {
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
        if (disposed) return;
        const point = points[index];
        watch(point.x + size / 2);
        moveTo("grok", point, {
          drift: true,
          onLand: () => {
            if (index === 1 || index === 3) {
              spawnSparks(fxRef.current, point.x + size / 2, point.y + 10, 1);
            }
            if (index === points.length - 1) {
              watch(null);
              moveTo("grok", home, { onDone: endInteraction });
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
    const poke = () => {
      const [sleeper, poker] = otherTwo();
      const size = mascotSize();
      poseFor(sleeper, "sleep", "closed");
      showBubble(sleeper, "Zzz…", 1800);
      window.setTimeout(() => {
        if (disposed) return;
        const home = { x: runtime[poker].x, y: runtime[poker].y };
        const spot = clampSpot(runtime[sleeper].x + size + 6, runtime[sleeper].y, size);
        moveTo(poker, spot, {
          onLand: () => {
            poseFor(sleeper, "alert", "wide");
            squash(sleeper);
            showBubble(sleeper, "！", 1400);
            showBubble(poker, "嘿，别睡～", 1800);
            window.setTimeout(() => {
              if (disposed) return;
              poseFor(sleeper, "idle", "open");
              moveTo(poker, home, { onDone: endInteraction });
            }, 1500);
          },
        });
      }, 1100);
    };

    // 合影庆祝：三只同屏各撒星星（下单成功后 30s 内优先）。
    const photo = () => {
      const size = mascotSize();
      for (const kind of KINDS) {
        poseFor(kind, "cheer", "happy");
        showBubble(kind, PHOTO_LINES[kind], 2400);
        squash(kind);
        spawnSparks(fxRef.current, runtime[kind].x + size / 2, runtime[kind].y + 6, 2);
      }
      window.setTimeout(() => {
        if (disposed) return;
        for (const kind of KINDS) poseFor(kind, "idle", "open");
        endInteraction();
      }, 2600);
    };

    const runInteraction = () => {
      if (isStatic()) {
        // reduced-motion / 移动端：只留同时冒出的气泡对，不做位移。
        const [a, b] = otherTwo();
        showBubble(a, pick(GREET_LINES[a]), 2200);
        showBubble(b, pick(GREET_LINES[b]), 2200);
        endInteraction();
        return;
      }
      interacting = true;
      // 下单成功后 30s 内优先拍合影，其余时间随机碰头 / 巡场 / 戳觉。
      const roll = Math.random();
      if (Date.now() - paidTimestamp() < PAID_WINDOW_MS) photo();
      else if (roll < 0.4) greet();
      else if (roll < 0.72) grokPatrol();
      else poke();
    };

    const scheduleInteraction = (
      delay = INTERACTION_MIN_MS + Math.random() * (INTERACTION_MAX_MS - INTERACTION_MIN_MS),
    ) => {
      window.clearTimeout(interactionTimer);
      interactionTimer = window.setTimeout(
        () => {
          if (disposed) return;
          if (!canInteract()) {
            scheduleInteraction();
            return;
          }
          runInteraction();
        },
        delay,
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

    const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
    const visibility = new Map<Element, number>();

    const reconcile = () => {
      if (disposed || isStatic() || interacting) return;
      // 布局各量一次再排序，比较器里不反复读 getBoundingClientRect。
      const ordered = Array.from(visibility.entries())
        .filter(([card, ratio]) => ratio > 0 && card.isConnected)
        .map(([card]) => {
          const el = card as HTMLElement;
          return { el, top: el.getBoundingClientRect().top };
        })
        .sort((a, b) => a.top - b.top)
        .map((entry) => entry.el);

      for (const kind of KINDS) {
        const rt = runtime[kind];
        const next =
          ordered.find((card) => {
            const owner = claims.get(card);
            return cardKinds(card).includes(kind) && (!owner || owner === kind);
          }) ?? null;

        if (!next) {
          if (rt.target) {
            claims.delete(rt.target);
            rt.target = null;
            sendHome(kind, true);
          }
          continue;
        }
        if (rt.target === next) continue;
        if (rt.hovering) continue;
        if (rt.target) claims.delete(rt.target);
        claims.set(next, kind);
        rt.target = next;
        jumpToCard(kind, next);
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

    const observeCards = () => {
      observer?.disconnect();
      visibility.clear();
      for (const card of cards) observer?.observe(card);
    };

    const followTarget = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        if (disposed || isStatic() || interacting) return;
        for (const kind of KINDS) {
          const rt = runtime[kind];
          if (!rt.target || rt.hovering || travelers[kind]?.busy) continue;
          const spot = spotNearCard(kind, rt.target.getBoundingClientRect());
          if (Math.abs(spot.x - rt.x) > 24 || Math.abs(spot.y - rt.y) > 24) {
            moveTo(kind, spot);
          }
        }
      });
    };

    // 滚动结束后再按新的视口重算一次，滚动中只做轻量跟随。
    const onScroll = () => {
      onActivity();
      followTarget();
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        followTarget();
        scheduleReconcile(140);
      }, 160);
    };

    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        // 互动编排靠 onLand 串动作，重排时别把正在走的位移掐断。
        if (disposed || interacting) return;
        readBottomInset();
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

    const activate = (kind: Kind) => {
      const rt = runtime[kind];
      // 正在位移时不插播蹦跳，避免两段 squash 动画打架。
      if (!travelers[kind]?.busy) travelers[kind]?.bounce();
      const card = rt.target ?? heroCard(kind);
      showBubble(
        kind,
        card ? CLICK_LINE : pick(kind === "grok" ? GROK_ROAM_LINES : FALLBACK_LINES),
        2600,
      );
      // 点一下就把商品带到眼前；静态模式直接跳，不要长距离平滑滚动。
      card?.scrollIntoView({
        behavior: reducedQuery.matches ? "auto" : "smooth",
        block: "center",
      });
    };

    const hover = (kind: Kind, on: boolean) => {
      const rt = runtime[kind];
      rt.hovering = on;
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

    // 换页重绑时先把姿态收回待机，别让上一页被打断的 Zzz / 惊吓跨页残留。
    for (const kind of KINDS) setPose(kind, IDLE_POSE);
    for (const kind of KINDS) sendHome(kind, false);
    for (const kind of KINDS) nodes[kind]?.classList.add("is-ready");
    observeCards();
    for (const kind of KINDS) {
      schedulePatrol(kind);
      scheduleAct(kind);
      scheduleBlink(kind);
      scheduleSaccade(kind);
    }
    scheduleInteraction();
    resetIdle();
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
    // 首屏已有商品卡在视野里时，不必等滚动才联动。
    scheduleReconcile(400);

    return () => {
      disposed = true;
      apiRef.current = null;
      observer?.disconnect();
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
          "is-typing",
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
    };
    // 分页 / 切分类 / 搜索都是 next/link 的客户端导航，组件实例不会重建：
    // 依赖 URL 让整段观察器跟着换页重绑，新一页的卡片才会被认领。
  }, [showBubble, hideBubble, navKey]);

  // grok 的视线跟鼠标：弹簧插值，页面隐藏或静止时停掉 rAF。
  useEffect(() => {
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
  }, []);

  // 气泡可能顶到视口边缘：先量出实际位置往内推，推好了再挂 is-visible 上屏，
  // 不然气泡会先在屏幕外出现再横跳一下。
  useEffect(() => {
    for (const kind of KINDS) {
      const text = bubbles[kind];
      if (!text) continue;
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
  }, [bubbles]);

  const setNode = (kind: Kind) => (el: HTMLDivElement | null) => {
    nodesRef.current[kind] = el;
  };
  const setLift = (kind: Kind) => (el: HTMLSpanElement | null) => {
    liftRef.current[kind] = el;
  };
  const setStance = (kind: Kind) => (el: HTMLSpanElement | null) => {
    stanceRef.current[kind] = el;
  };

  const mascot = (kind: Kind) => (
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
            <ShopMascotIdlePose kind={kind} eyes={poses[kind].eyes} state={poses[kind].state} />
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
      {bubbles[kind] ? (
        <span className="shop-mascot-bubble" aria-hidden="true">
          {bubbles[kind]}
        </span>
      ) : null}
    </div>
  );

  return (
    <>
      {KINDS.map((kind) => mascot(kind))}
      <div ref={fxRef} className="shop-mascot-fx" aria-hidden="true" />
    </>
  );
}
