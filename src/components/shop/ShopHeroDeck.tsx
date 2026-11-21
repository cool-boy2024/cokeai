"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent,
  type PointerEvent,
} from "react";
import styles from "./ShopHeroDeck.module.css";

export type ShopDeckCard = {
  href: string;
  name: string;
  brand: string;
  priceLabel: string;
  tone: "ink" | "green" | "sand" | "clay" | "slate";
};

const DECK_LIMIT = 5;
const MOBILE_MQ = "(max-width: 734px)";
const SWIPE_LOCK = 12;
const SWIPE_FLIP = 56;
const AUTO_MS = 3500;
const QUIET_MS = 6000;

/** Same slot table as fk1.ybkjs.top `.fan-card` `--x/--y/--r/--z`. */
const SLOTS = [
  { x: 0, y: 0, r: 0, z: 5 },
  { x: -286, y: 30, r: -6, z: 4 },
  { x: 286, y: 30, r: 6, z: 4 },
  { x: -556, y: 100, r: -12, z: 3 },
  { x: 556, y: 100, r: 12, z: 3 },
] as const;

const PALETTE: Record<string, readonly [string, string, string]> = {
  chatgpt: ["#08241e", "#0e5646", "#1b9c7a"],
  claude: ["#6e2c15", "#b9583a", "#e39b74"],
  gemini: ["#16338f", "#4566e8", "#a67be0"],
  grok: ["#0b0b0d", "#2a2a2e", "#64646b"],
  perplexity: ["#082427", "#11616a", "#33aeb9"],
};

const FALLBACK: Array<readonly [string, string, string]> = [
  PALETTE.chatgpt,
  PALETTE.gemini,
  PALETTE.claude,
  PALETTE.grok,
  PALETTE.perplexity,
];

type Swipe = {
  id: number;
  x: number;
  y: number;
  locked: boolean;
};

function brandInitial(brand: string): string {
  const ch = Array.from(brand.trim())[0];
  return ch ? ch.toUpperCase() : "·";
}

function paletteOf(brand: string, index: number): readonly [string, string, string] {
  const key = brand.toLowerCase();
  if (/chat|gpt|openai/.test(key)) return PALETTE.chatgpt;
  if (/claude/.test(key)) return PALETTE.claude;
  if (/gemini/.test(key)) return PALETTE.gemini;
  if (/grok|xai|super/.test(key)) return PALETTE.grok;
  if (/perplex/.test(key)) return PALETTE.perplexity;
  return FALLBACK[index % FALLBACK.length];
}

/** Center ChatGPT, inner Gemini/Claude, outer Grok/Perplexity — same seats as the reference fan. */
function slotRank(brand: string): number {
  const key = brand.toLowerCase();
  if (/chat|gpt|openai/.test(key)) return 0;
  if (/gemini/.test(key)) return 1;
  if (/claude/.test(key)) return 2;
  if (/grok|xai|super/.test(key)) return 3;
  if (/perplex/.test(key)) return 4;
  return 9;
}

function isMobile(): boolean {
  return window.matchMedia(MOBILE_MQ).matches;
}

/**
 * Membership-card fan. Layout, glow, sheen, float, and scroll-spread match
 * the public storefront we mirrored; colours stay on the brand chips.
 */
export function ShopHeroDeck({ cards }: { cards: ShopDeckCard[] }): JSX.Element | null {
  const deck = cards
    .slice(0, DECK_LIMIT)
    .slice()
    .sort((a, b) => slotRank(a.brand) - slotRank(b.brand));
  const [order, setOrder] = useState<number[]>(() => deck.map((_, i) => i));
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<Swipe | null>(null);
  const skipClick = useRef(false);
  const quietUntil = useRef(0);
  const leaveTimer = useRef(0);
  const count = deck.length;

  const deckKey = deck.map((card) => card.href).join("|");
  useEffect(() => {
    setOrder(deck.map((_, i) => i));
  }, [deckKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    let frame = 0;

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!reduced) {
          root.style.setProperty("--spread", Math.min(1, window.scrollY / 520).toFixed(3));
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const onMove = (event: globalThis.PointerEvent) => {
      if (reduced || !fine) return;
      const box = root.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      root.style.setProperty("--mx", ((event.clientX - box.left) / box.width * 2 - 1).toFixed(3));
      root.style.setProperty("--my", ((event.clientY - box.top) / box.height * 2 - 1).toFixed(3));
    };
    const onLeave = () => {
      root.style.setProperty("--mx", "0");
      root.style.setProperty("--my", "0");
    };
    if (fine && !reduced) {
      root.addEventListener("pointermove", onMove);
      root.addEventListener("pointerleave", onLeave);
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function hush() {
    quietUntil.current = Date.now() + QUIET_MS;
  }

  function step(dir: 1 | -1) {
    if (count < 2) return;
    setLeaving(dir > 0 ? "left" : "right");
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(null), 600);
    setOrder((current) =>
      dir > 0
        ? [...current.slice(1), current[0]]
        : [current[current.length - 1], ...current.slice(0, -1)],
    );
  }

  useEffect(() => {
    if (count < 2) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const tick = window.setInterval(() => {
      if (!isMobile()) return;
      if (document.hidden) return;
      if (Date.now() < quietUntil.current) return;
      step(1);
    }, AUTO_MS);
    return () => window.clearInterval(tick);
  }, [count]);

  if (count === 0) return null;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (count < 2 || !isMobile()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    hush();
    swipe.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      locked: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.locked) {
      if (Math.abs(dx) < SWIPE_LOCK && Math.abs(dy) < SWIPE_LOCK) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        swipe.current = null;
        return;
      }
      start.locked = true;
      skipClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId || !start.locked) return;
    const dx = event.clientX - start.x;
    if (dx <= -SWIPE_FLIP) step(1);
    else if (dx >= SWIPE_FLIP) step(-1);
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!skipClick.current) return;
    skipClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const front = order[0] ?? 0;

  return (
    <div ref={rootRef} className={styles.root} style={{ "--spread": 0, "--mx": 0, "--my": 0 } as CSSProperties}>
      <div
        className={styles.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onClickCapture={onClickCapture}
      >
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.fan}>
          {deck.map((card, i) => {
            const slot = SLOTS[i] || SLOTS[0];
            const pos = order.indexOf(i);
            const [c1, c2, c3] = paletteOf(card.brand, i);
            const out =
              leaving === "left" && pos === count - 1
                ? styles.outLeft
                : leaving === "right" && pos === 0
                  ? styles.outRight
                  : "";
            return (
              <Link
                key={card.href}
                href={card.href}
                className={`${styles.card} ${i >= 3 ? styles.outer : ""} ${out}`}
                data-pos={String(pos < 0 ? i : pos)}
                style={
                  {
                    "--x": slot.x,
                    "--y": slot.y,
                    "--r": slot.r,
                    "--z": slot.z,
                    "--i": i,
                    "--c1": c1,
                    "--c2": c2,
                    "--c3": c3,
                    "--fd": `${(-i * 1.7).toFixed(1)}s`,
                    "--sd": `${(i * 1.9).toFixed(1)}s`,
                  } as CSSProperties
                }
                aria-label={`${card.brand} ${card.name} ${card.priceLabel}`}
              >
                <span className={styles.float}>
                  <span className={styles.mcard}>
                    <span className={styles.top}>
                      <span className={styles.chip} aria-hidden="true">
                        {brandInitial(card.brand)}
                      </span>
                      <span className={styles.brand}>{card.brand}</span>
                    </span>
                    <strong className={styles.name}>{card.name}</strong>
                    <span className={styles.foot}>
                      <span className={styles.issuer}>CokeAI · 会员</span>
                      <span className={styles.price}>{card.priceLabel}</span>
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
        <div className={styles.floor} aria-hidden="true" />
        {count > 1 ? (
          <div className={styles.dots} role="group" aria-label="会员卡片">
            {deck.map((card, i) => (
              <button
                key={`${card.href}-dot`}
                type="button"
                className={`${styles.dot} ${i === front ? styles.dotOn : ""}`}
                aria-label={card.name}
                aria-current={i === front ? "true" : undefined}
                onClick={() => {
                  hush();
                  const at = order.indexOf(i);
                  if (at <= 0) return;
                  setOrder((current) => [...current.slice(at), ...current.slice(0, at)]);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.dock} aria-hidden="true">
        {deck.map((card) => (
          <span key={`${card.href}-dock`} className={styles.dockItem}>
            {brandInitial(card.brand)}
          </span>
        ))}
      </div>
    </div>
  );
}
