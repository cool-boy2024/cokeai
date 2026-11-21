"use client";

import Link from "next/link";
import {
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
const SWIPE_LOCK = 12;
const SWIPE_FLIP = 40;

const TONE_CLASS: Record<ShopDeckCard["tone"], string> = {
  ink: styles.ink,
  green: styles.green,
  sand: styles.sand,
  clay: styles.clay,
  slate: styles.slate,
};

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

function stackClass(offset: number, count: number): string {
  if (count <= 1 || offset === 0) return styles.isFront;
  if (offset === 1) return styles.isPeek;
  if (offset === 2) return styles.isPeekDeep;
  return styles.isHidden;
}

function isCompactViewport(): boolean {
  return window.matchMedia("(max-width: 720px)").matches;
}

/**
 * 小店英雄区会员卡扇面。最多 5 张；标题和 CTA 由父级渲染。
 */
export function ShopHeroDeck({ cards }: { cards: ShopDeckCard[] }): JSX.Element | null {
  const deck = cards.slice(0, DECK_LIMIT);
  const [active, setActive] = useState(0);
  const swipe = useRef<Swipe | null>(null);
  const skipClick = useRef(false);

  if (deck.length === 0) {
    return null;
  }

  const count = deck.length;
  const mid = (count - 1) / 2;
  const index = ((active % count) + count) % count;

  function go(delta: number) {
    setActive((current) => ((current + delta) % count + count) % count);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (count < 2 || !isCompactViewport()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
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
      // 竖滑交给页面滚动，不抢手势。
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
    if (dx <= -SWIPE_FLIP) go(1);
    else if (dx >= SWIPE_FLIP) go(-1);
  }

  function onPointerCancel() {
    swipe.current = null;
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!skipClick.current) return;
    skipClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className={styles.root}>
      <div
        className={styles.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {deck.map((card, i) => {
          const fan = count === 1 ? 0 : (i - mid) / mid;
          const offset = (i - index + count) % count;
          return (
            <Link
              key={`${card.href}-${i}`}
              href={card.href}
              className={`${styles.card} ${TONE_CLASS[card.tone]} ${stackClass(offset, count)}`}
              style={
                {
                  "--fan": String(fan),
                  "--fan-abs": String(Math.abs(fan)),
                  "--z": String(Math.round(count - Math.abs(i - mid))),
                } as CSSProperties
              }
              aria-label={`${card.brand} ${card.name} ${card.priceLabel}`}
            >
              <span className={styles.kicker}>
                <span className={styles.badge} aria-hidden="true">
                  {brandInitial(card.brand)}
                </span>
                <span className={styles.kickerText}>{card.brand}</span>
              </span>
              <strong className={styles.name}>{card.name}</strong>
              <span className={styles.foot}>
                <span className={styles.issuer}>{card.brand}</span>
                <span className={styles.price}>{card.priceLabel}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {count > 1 ? (
        <div className={styles.dots} role="group" aria-label="会员卡片">
          {deck.map((card, i) => {
            const current = i === index;
            return (
              <button
                key={`${card.href}-dot-${i}`}
                type="button"
                className={styles.dot}
                aria-label={card.name}
                aria-current={current ? "true" : undefined}
                onClick={() => setActive(i)}
              />
            );
          })}
        </div>
      ) : null}

      <div className={styles.marks} aria-hidden="true">
        {deck.map((card, i) => (
          <span key={`${card.href}-mark-${i}`} className={styles.mark}>
            {brandInitial(card.brand)}
          </span>
        ))}
      </div>
    </div>
  );
}
