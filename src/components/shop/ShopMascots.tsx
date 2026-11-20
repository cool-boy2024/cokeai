"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeSupplierCopy } from "@/lib/shop/sanitize";

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
};

const CLICK_LINE = "跟着我看好货 →";

/**
 * 话术只取商品卡上的名称、价格、质保、已售；名称先过供应商文案清洗，
 * 所以气泡里不会出现货源域名、「货源」字样或外链。
 */
function bubbleLines(info: CardInfo): string[] {
  const short = shortName(info.name, 11);
  const full = shortName(info.name, 14);
  const lines = [`${short} · ${info.price ?? "点我看看"}`, `点我看看${short}`];
  if (info.warranty) lines.push(`${full} · ${info.warranty}`);
  if (info.sales) lines.push(`${short} · ${info.sales}`);
  if (info.price) lines.push(`${short}，${info.price}`);
  return lines;
}

const FALLBACK_LINES = ["点我直接看", "热卖中！点我看看", CLICK_LINE];

/** 商品名里的【直充｜月卡】是卖点后缀，气泡里只留商品本名。 */
function shortName(name: string, limit: number): string {
  const head = name.split(/【|\[|（|\(|｜|\|/)[0]?.trim() || "";
  return truncate(head.length >= 2 ? head : name, limit);
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  if (chars.length <= limit) return clean;
  const cut = chars.slice(0, limit).join("");
  const space = cut.lastIndexOf(" ");
  // 截断点落在英文单词中间时退回上一个空格，别留下 "Claude pr…"。
  const head = space > 0 && /[A-Za-z0-9]$/.test(cut) ? cut.slice(0, space) : cut;
  return `${head}…`;
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
        maxY: Math.max(EDGE_GAP, vh - EDGE_GAP - size),
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

    const idleSpot = (kind: Kind) => {
      const { vw, vh } = viewport();
      const size = mascotSize();
      if (kind === "claude") {
        return { x: EDGE_GAP, y: Math.max(EDGE_GAP, vh - EDGE_GAP - size) };
      }
      const x = Math.max(EDGE_GAP, vw - EDGE_GAP - size);
      let y = Math.max(EDGE_GAP, vh - EDGE_GAP - size);
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
        window.setTimeout(() => {
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
        nodes[kind]?.classList.remove("is-jumping", "is-ready", ...EGG_ACTIONS);
      }
      for (const kind of KINDS) window.clearTimeout(bubbleTimers.current[kind]);
    };
  }, [showBubble, hideBubble]);

  // 气泡可能顶到视口边缘：量一次实际位置，往内推。
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
      if (rect.left < 12) shift = 12 - rect.left;
      else if (rect.right > vw - 12) shift = vw - 12 - rect.right;
      bubble.style.setProperty("--bubble-shift", `${Math.round(shift)}px`);
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
          <span className="shop-mascot-bubble is-visible" aria-hidden="true">
            {bubbles.claude}
          </span>
        ) : null}
        <span className="shop-mascot-hop">
          <span className="shop-mascot-idle">
            <span className="shop-mascot-mood">
              <ClaudeMascotArt />
            </span>
          </span>
        </span>
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
          <span className="shop-mascot-bubble is-visible" aria-hidden="true">
            {bubbles.gpt}
          </span>
        ) : null}
        <span className="shop-mascot-hop">
          <span className="shop-mascot-idle">
            <span className="shop-mascot-mood">
              <GPTMascotArt />
            </span>
          </span>
        </span>
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
  };
}

/** 12 道圆头射线：长短交替 + 整体略歪，保持手绘星芒的手感。 */
const STAR_RAYS = [
  { angle: -90, length: 31 },
  { angle: -60, length: 25 },
  { angle: -30, length: 30 },
  { angle: 0, length: 24 },
  { angle: 30, length: 30 },
  { angle: 60, length: 25 },
  { angle: 90, length: 31 },
  { angle: 120, length: 26 },
  { angle: 150, length: 29 },
  { angle: 180, length: 23 },
  { angle: 210, length: 30 },
  { angle: 240, length: 26 },
];

const STAR_CENTER = { x: 48, y: 31 };

// 坐标取三位小数：服务端和浏览器的 Math.sin 末位不同，不圆整会触发 hydration 不匹配。
function round(value: number) {
  return Number(value.toFixed(3));
}

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    x: round(STAR_CENTER.x + Math.cos(rad) * radius),
    y: round(STAR_CENTER.y + Math.sin(rad) * radius),
  };
}

/** 圆角星芒 + 大圆眼 + 卡通大框墨镜 + 小短脚：Q 版比例，头大身小。 */
function ClaudeMascotArt() {
  return (
    <svg
      className="shop-mascot-art"
      viewBox="0 0 96 96"
      aria-hidden="true"
      focusable="false"
    >
      {/* 小短脚和身子：头部占角色约三分之二 */}
      <g fill="#B85C3F">
        <rect x="35" y="74" width="10.5" height="9" rx="4.4" />
        <rect x="50.5" y="74" width="10.5" height="9" rx="4.4" />
      </g>
      <rect x="35" y="47" width="26" height="30" rx="13" fill="#CF6B4A" />
      {/* 星芒做圆角化：长短交替的圆头射线围着一个圆脸 */}
      <g
        transform="rotate(-5 48 31)"
        stroke="#D97757"
        strokeWidth="7.4"
        strokeLinecap="round"
      >
        {STAR_RAYS.map((ray) => {
          const inner = polar(ray.angle, 20);
          const outer = polar(ray.angle, ray.length);
          return (
            <line
              key={ray.angle}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
            />
          );
        })}
      </g>
      <circle cx="48" cy="31" r="22.5" fill="#D97757" />
      {/* 腮红 */}
      <ellipse cx="32" cy="43.5" rx="5.4" ry="3.2" fill="#F4718C" opacity="0.58" />
      <ellipse cx="64" cy="43.5" rx="5.4" ry="3.2" fill="#F4718C" opacity="0.58" />
      {/* 大圆眼：白色高光点让眼神发亮 */}
      <g className="shop-mascot-eye">
        <ellipse cx="35" cy="30.5" rx="6.2" ry="6.2" fill="#FFFDF8" />
        <circle cx="35.9" cy="31.4" r="3.5" fill="#231D1A" />
        <circle cx="33.7" cy="28.8" r="1.9" fill="#FFFFFF" />
        <circle cx="37.4" cy="33.6" r="0.95" fill="#FFFFFF" opacity="0.9" />
      </g>
      <g className="shop-mascot-eye">
        <ellipse cx="61" cy="30.5" rx="6.2" ry="6.2" fill="#FFFDF8" />
        <circle cx="61.9" cy="31.4" r="3.5" fill="#231D1A" />
        <circle cx="59.7" cy="28.8" r="1.9" fill="#FFFFFF" />
        <circle cx="63.4" cy="33.6" r="0.95" fill="#FFFFFF" opacity="0.9" />
      </g>
      {/* 卡通大框圆角墨镜：浅暖色镜片，眼睛仍清楚可见 */}
      <g fill="#FFD9C6" fillOpacity="0.3" stroke="#1D1B1A" strokeWidth="3.3">
        <rect x="22.5" y="22" width="24.5" height="17.5" rx="7.8" />
        <rect x="49" y="22" width="24.5" height="17.5" rx="7.8" />
      </g>
      <path
        d="M47 29.5 L49 29.5"
        stroke="#1D1B1A"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
      <path
        d="M22.9 27.2 L13.2 23.2 M73.1 27.2 L82.8 23.2"
        stroke="#1D1B1A"
        strokeWidth="3.1"
        strokeLinecap="round"
      />
      {/* 小嘴：墨镜下方一点点 */}
      <path
        d="M44.9 45.8 Q48 48.6 51.1 45.8"
        stroke="#B85C3F"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** OpenAI 花结：六段圆头短线拧成风车，中心留出六边形空心放脸。 */
const KNOT = { cx: 48, cy: 32, distance: 21.2, length: 27, thickness: 10.2, twist: 3.4 };

const KNOT_ARMS = [0, 60, 120, 180, 240, 300].map((offset) => {
  const angle = offset - 90;
  const rad = (angle * Math.PI) / 180;
  const tangent = { x: -Math.sin(rad), y: Math.cos(rad) };
  const center = {
    x: KNOT.cx + Math.cos(rad) * KNOT.distance + tangent.x * KNOT.twist,
    y: KNOT.cy + Math.sin(rad) * KNOT.distance + tangent.y * KNOT.twist,
  };
  const half = KNOT.length / 2;
  return {
    x1: round(center.x - tangent.x * half),
    y1: round(center.y - tangent.y * half),
    x2: round(center.x + tangent.x * half),
    y2: round(center.y + tangent.y * half),
  };
});

/** 绿色花结 + 直接在花结中心点上的大圆眼 + 腮红 + 小短脚，不带任何文字标签。 */
function GPTMascotArt() {
  return (
    <svg
      className="shop-mascot-art"
      viewBox="0 0 96 96"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="#0C7D62">
        <rect x="36.5" y="72" width="10" height="8.5" rx="4.2" />
        <rect x="49.5" y="72" width="10" height="8.5" rx="4.2" />
      </g>
      <rect x="37.5" y="51" width="21" height="24" rx="10.5" fill="#0C7D62" />
      <g
        transform="rotate(-6 48 32)"
        stroke="#10A37F"
        strokeWidth={KNOT.thickness}
        strokeLinecap="round"
      >
        {KNOT_ARMS.map((arm, index) => (
          <line key={index} x1={arm.x1} y1={arm.y1} x2={arm.x2} y2={arm.y2} />
        ))}
      </g>
      {/* 腮红 */}
      <ellipse cx="31" cy="42" rx="5.8" ry="3.5" fill="#FFAD8F" opacity="0.95" />
      <ellipse cx="65" cy="42" rx="5.8" ry="3.5" fill="#FFAD8F" opacity="0.95" />
      {/* 眼睛直接点在花结中心 */}
      <g className="shop-mascot-eye">
        <ellipse cx="40.9" cy="31.5" rx="5.8" ry="5.8" fill="#FFFDF8" />
        <circle cx="41.6" cy="32.3" r="3.3" fill="#0B2B22" />
        <circle cx="39.8" cy="30" r="1.7" fill="#FFFFFF" />
        <circle cx="42.9" cy="34" r="0.85" fill="#FFFFFF" opacity="0.9" />
      </g>
      <g className="shop-mascot-eye">
        <ellipse cx="55.1" cy="31.5" rx="5.8" ry="5.8" fill="#FFFDF8" />
        <circle cx="55.8" cy="32.3" r="3.3" fill="#0B2B22" />
        <circle cx="54" cy="30" r="1.7" fill="#FFFFFF" />
        <circle cx="57.1" cy="34" r="0.85" fill="#FFFFFF" opacity="0.9" />
      </g>
      {/* 小嘴 */}
      <path
        d="M45.6 42.8 Q48 45.6 50.4 42.8"
        stroke="#083527"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
