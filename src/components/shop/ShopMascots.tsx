"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SUPPLIER_PLACEHOLDER, sanitizeSupplierCopy } from "@/lib/shop/sanitize";
import { ShopMascotIdlePose } from "./ShopMascotArt";

const KINDS = ["claude", "gpt"] as const;
type Kind = (typeof KINDS)[number];

const DESKTOP_SIZE = 84;
const MOBILE_SIZE = 48;
const EDGE_GAP = 22;
const TOP_SAFE = 96;
const SUPPORT_PAD = 10;
const BUBBLE_HOLD_MS = 3400;
const PATROL_MIN_MS = 6000;
const PATROL_MAX_MS = 10000;
const EGG_MIN_MS = 20000;
const EGG_MAX_MS = 30000;
const EGG_HOLD_MS = 1400;
const CARD_SELECTOR = "a.shop-row, a.shop-product-card";
const EGG_ACTIONS = ["is-tilt", "is-spin", "is-sway"] as const;
/** 气泡离视口左右边缘至少留这么多，量出来再位移。 */
const BUBBLE_EDGE = 12;

type CardInfo = {
  name: string;
  price: string | null;
  warranty: string | null;
  sales: string | null;
};

type Runtime = {
  x: number;
  y: number;
  target: HTMLElement | null;
  hovering: boolean;
  moving: boolean;
  patrolTimer: number;
  hopTimer: number;
  eggTimer: number;
  eggClearTimer: number;
  moveClearTimer: number;
};

const CLICK_LINE = "跟着我看好货 →";

const FALLBACK_LINES = ["点我直接看", "热卖中！点我看看", CLICK_LINE];

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

/** 商品卡没有 data-category：按标题 + 品牌关键词归类，两个都对就都算。 */
function cardKinds(card: HTMLElement): Kind[] {
  const name = card.querySelector("h3")?.textContent || "";
  const brand =
    card.querySelector(".shop-row-kicker span, .shop-product-brand")?.textContent || "";
  const haystack = `${name} ${brand}`.toLowerCase();
  const kinds: Kind[] = [];
  if (/claude|anthropic/.test(haystack)) kinds.push("claude");
  if (/gpt|openai|chatgpt/.test(haystack)) kinds.push("gpt");
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

export function ShopMascots() {
  const [bubbles, setBubbles] = useState<Record<Kind, string | null>>({
    claude: null,
    gpt: null,
  });
  const nodesRef = useRef<Record<Kind, HTMLDivElement | null>>({ claude: null, gpt: null });
  const runtimeRef = useRef<Record<Kind, Runtime>>({
    claude: newRuntime(),
    gpt: newRuntime(),
  });
  const bubbleTimers = useRef<Record<Kind, number>>({ claude: 0, gpt: 0 });
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

    // 移动端和「减少动态效果」都只做静态站立，区别是移动端仍占两个角。
    const isStatic = () => reducedQuery.matches || mobileQuery.matches;
    const mascotSize = () => (mobileQuery.matches ? MOBILE_SIZE : DESKTOP_SIZE);

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

    const hitsSupport = (x: number, y: number, size: number) => {
      const box = supportBox();
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

    // 两个角色的待机位规则一致：各占一侧下角，谁都不会压在客服按钮上，
    // 也都会让开刘海屏底部的 Home 指示条。
    const idleSpot = (kind: Kind) => {
      const { vw } = viewport();
      const size = mascotSize();
      const x =
        kind === "claude" ? EDGE_GAP : Math.max(EDGE_GAP, vw - EDGE_GAP - size);
      let y = bottomBaseline();
      const box = supportBox();
      if (box && hitsSupport(x, y, size)) y = Math.max(EDGE_GAP, box.top - size - 10);
      return { x, y };
    };

    const restartHop = (kind: Kind, duration: number) => {
      const node = nodes[kind];
      if (!node) return;
      node.classList.remove("is-jumping");
      // 跳跃的横向位移时长写在 --hop-ms 上，纵向 squash & stretch 跟它同步。
      node.style.setProperty("--hop-ms", `${Math.round(duration)}ms`);
      // 读一次布局，让同一段 keyframes 能重新播放。
      void node.offsetWidth;
      node.classList.add("is-jumping");
      window.clearTimeout(runtime[kind].hopTimer);
      runtime[kind].hopTimer = window.setTimeout(() => {
        node.classList.remove("is-jumping");
      }, duration + 80);
    };

    const move = (
      kind: Kind,
      x: number,
      y: number,
      duration: number,
      hop: boolean,
    ) => {
      const node = nodes[kind];
      if (!node) return;
      const rt = runtime[kind];
      const spot = clampSpot(x, y, mascotSize());
      rt.x = spot.x;
      rt.y = spot.y;
      node.style.transitionDuration = duration > 0 ? `${duration}ms` : "0ms";
      node.style.transform = `translate3d(${Math.round(spot.x)}px, ${Math.round(spot.y)}px, 0)`;
      if (duration > 0 && hop) {
        restartHop(kind, duration);
        rt.moving = true;
        window.clearTimeout(rt.moveClearTimer);
        rt.moveClearTimer = window.setTimeout(() => {
          rt.moving = false;
        }, duration);
      }
    };

    const spotNearCard = (kind: Kind, rect: DOMRect) => {
      const size = mascotSize();
      const { vw } = viewport();
      const { minX, maxX, minY, maxY } = limits();
      // 星芒侠站卡片左侧的栏间留白，小绿花站右侧留白，两个角色不打架。
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
      const other = runtime[kind === "claude" ? "gpt" : "claude"];
      if (Math.hypot(x - other.x, y - other.y) < size + 12) {
        y = Math.min(Math.max(y - size - 16, minY), maxY);
      }
      return { x, y };
    };

    const heroCard = (kind: Kind): HTMLElement | null => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
      return cards.find((card) => cardKinds(card).includes(kind)) ?? null;
    };

    const cards = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
    const visibility = new Map<Element, number>();

    const announceCard = (kind: Kind, card: HTMLElement) => {
      showBubble(kind, pick(bubbleLines(readCard(card))));
    };

    const jumpToCard = (kind: Kind, card: HTMLElement) => {
      const rect = card.getBoundingClientRect();
      const spot = spotNearCard(kind, rect);
      move(kind, spot.x, spot.y, 260 + Math.random() * 80, true);
      announceCard(kind, card);
    };

    const sendHome = (kind: Kind, animate: boolean) => {
      const spot = idleSpot(kind);
      move(kind, spot.x, spot.y, animate ? 320 : 0, animate);
    };

    const randomSpot = (kind: Kind) => {
      const rt = runtime[kind];
      const other = runtime[kind === "claude" ? "gpt" : "claude"];
      const size = mascotSize();
      const { minX, maxX, minY, maxY } = limits();
      let best = { x: rt.x, y: rt.y };
      let bestScore = -1;
      for (let i = 0; i < 14; i += 1) {
        const x = minX + Math.random() * Math.max(1, maxX - minX);
        const y = minY + Math.random() * Math.max(1, maxY - minY);
        if (hitsSupport(x, y, size)) continue;
        const apart = Math.hypot(x - other.x, y - other.y);
        if (apart < size + 24) continue;
        // 既要有明显位移，又要离另一个角色远一点。
        const score = Math.min(600, Math.hypot(x - rt.x, y - rt.y)) + apart * 0.2;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
      return best;
    };

    const schedulePatrol = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.patrolTimer);
      // 6-10s 一次抛物线巡逻跳。
      rt.patrolTimer = window.setTimeout(
        () => {
          if (disposed) return;
          if (isStatic() || rt.hovering || rt.target || rt.moving) {
            schedulePatrol(kind);
            return;
          }
          const spot = randomSpot(kind);
          move(kind, spot.x, spot.y, 380 + Math.random() * 160, true);
          schedulePatrol(kind);
        },
        PATROL_MIN_MS + Math.random() * (PATROL_MAX_MS - PATROL_MIN_MS),
      );
    };

    const scheduleEgg = (kind: Kind) => {
      const rt = runtime[kind];
      window.clearTimeout(rt.eggTimer);
      // 20-30s 一次待机彩蛋：歪头 / 原地小转圈 / 左右摇摆。
      rt.eggTimer = window.setTimeout(
        () => {
          if (disposed) return;
          const node = nodes[kind];
          if (!node || isStatic() || rt.hovering || rt.moving) {
            scheduleEgg(kind);
            return;
          }
          const action = pick(EGG_ACTIONS);
          node.classList.remove(...EGG_ACTIONS);
          void node.offsetWidth;
          node.classList.add(action);
          window.clearTimeout(rt.eggClearTimer);
          rt.eggClearTimer = window.setTimeout(() => {
            node.classList.remove(...EGG_ACTIONS);
          }, EGG_HOLD_MS);
          scheduleEgg(kind);
        },
        EGG_MIN_MS + Math.random() * (EGG_MAX_MS - EGG_MIN_MS),
      );
    };

    const scheduleReconcile = (delay = 180) => {
      window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = 0;
        reconcile();
      }, delay);
    };

    const reconcile = () => {
      if (disposed || isStatic()) return;
      const ordered = Array.from(visibility.entries())
        .filter(([card, ratio]) => ratio > 0 && card.isConnected)
        .map(([card]) => card as HTMLElement)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

      for (const kind of KINDS) {
        const rt = runtime[kind];
        const rival: Kind = kind === "claude" ? "gpt" : "claude";
        const next =
          ordered.find(
            (card) => cardKinds(card).includes(kind) && claims.get(card) !== rival,
          ) ?? null;

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
        if (disposed || isStatic()) return;
        for (const kind of KINDS) {
          const rt = runtime[kind];
          if (!rt.target || rt.moving || rt.hovering) continue;
          const spot = spotNearCard(kind, rt.target.getBoundingClientRect());
          if (Math.abs(spot.x - rt.x) > 24 || Math.abs(spot.y - rt.y) > 24) {
            move(kind, spot.x, spot.y, 240, false);
          }
        }
      });
    };

    // 滚动结束后再按新的视口重算一次，滚动中只做轻量跟随。
    const onScroll = () => {
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
        if (disposed) return;
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

    const activate = (kind: Kind) => {
      const rt = runtime[kind];
      restartHop(kind, 420);
      const card = rt.target ?? heroCard(kind);
      showBubble(kind, CLICK_LINE, 2600);
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
        showBubble(kind, info ? pick(bubbleLines(info)) : pick(FALLBACK_LINES), 4200);
      } else {
        hideBubble(kind, 700);
        scheduleReconcile(320);
      }
    };

    apiRef.current = { activate, hover };

    for (const kind of KINDS) sendHome(kind, false);
    for (const kind of KINDS) nodes[kind]?.classList.add("is-ready");
    observeCards();
    for (const kind of KINDS) schedulePatrol(kind);
    for (const kind of KINDS) scheduleEgg(kind);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
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
      reducedQuery.removeEventListener("change", onMotionChange);
      mobileQuery.removeEventListener("change", onResize);
      window.clearTimeout(reconcileTimer);
      window.clearTimeout(resizeTimer);
      window.clearTimeout(scrollTimer);
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      for (const kind of KINDS) {
        window.clearTimeout(runtime[kind].patrolTimer);
        window.clearTimeout(runtime[kind].hopTimer);
        window.clearTimeout(runtime[kind].eggTimer);
        window.clearTimeout(runtime[kind].eggClearTimer);
        window.clearTimeout(runtime[kind].moveClearTimer);
        nodes[kind]?.classList.remove("is-jumping", "is-ready", ...EGG_ACTIONS);
      }
      for (const kind of KINDS) window.clearTimeout(bubbleTimers.current[kind]);
    };
    // 分页 / 切分类 / 搜索都是 next/link 的客户端导航，组件实例不会重建：
    // 依赖 URL 让整段观察器跟着换页重绑，新一页的卡片才会被认领。
  }, [showBubble, hideBubble, navKey]);

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

  return (
    <>
      <div
        ref={setNode("claude")}
        className="shop-mascot shop-mascot-claude"
        role="button"
        tabIndex={0}
        aria-label="星芒墨镜侠：带你看 Claude 商品"
        onClick={() => apiRef.current?.activate("claude")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            apiRef.current?.activate("claude");
          }
        }}
        onMouseEnter={() => apiRef.current?.hover("claude", true)}
        onMouseLeave={() => apiRef.current?.hover("claude", false)}
      >
        {bubbles.claude ? (
          <span className="shop-mascot-bubble" aria-hidden="true">
            {bubbles.claude}
          </span>
        ) : null}
        <ShopMascotIdlePose kind="claude" />
      </div>
      <div
        ref={setNode("gpt")}
        className="shop-mascot shop-mascot-gpt"
        role="button"
        tabIndex={0}
        aria-label="小绿花：带你看 GPT 商品"
        onClick={() => apiRef.current?.activate("gpt")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            apiRef.current?.activate("gpt");
          }
        }}
        onMouseEnter={() => apiRef.current?.hover("gpt", true)}
        onMouseLeave={() => apiRef.current?.hover("gpt", false)}
      >
        {bubbles.gpt ? (
          <span className="shop-mascot-bubble" aria-hidden="true">
            {bubbles.gpt}
          </span>
        ) : null}
        <ShopMascotIdlePose kind="gpt" />
      </div>
    </>
  );
}

function newRuntime(): Runtime {
  return {
    x: 0,
    y: 0,
    target: null,
    hovering: false,
    moving: false,
    patrolTimer: 0,
    hopTimer: 0,
    eggTimer: 0,
    eggClearTimer: 0,
    moveClearTimer: 0,
  };
}
