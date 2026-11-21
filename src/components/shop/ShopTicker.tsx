"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type TickerItem = {
  id: string;
  nth: number;
  name: string;
  soldToday: number;
  stock: number | null;
  preorder: boolean;
};

type Slip = TickerItem & { lane: number; travelMs: number };

const HIDDEN = [/^\/$/, /^\/login(?:\/|$)/, /^\/admin(?:\/|$)/];
const GREETING = "恭喜老板发财，祝 2026 顺风顺水顺财神";
const PASS_MS = 18_000;

function hiddenPath(pathname: string): boolean {
  return HIDDEN.some((rule) => rule.test(pathname));
}

function waitMs(finishedCycle: boolean): number {
  if (finishedCycle) return 60_000 + Math.random() * 3 * 60_000;
  return 4_000 + Math.random() * 8_000;
}

function stockLine(item: TickerItem): string {
  if (item.preorder) return "库存很多，欢迎来预定";
  if (item.stock === null) return "有货";
  if (item.stock <= 0) return "正在补货";
  return `还剩 ${item.stock} 件`;
}

export function ShopTicker() {
  const pathname = usePathname();
  const hidden = hiddenPath(pathname);
  const [slip, setSlip] = useState<Slip | null>(null);
  const slipRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (hidden) return;
    let stopped = false;
    let timer = 0;
    let clearTimer = 0;
    let cursor = 0;
    let items: TickerItem[] = [];

    const show = (item: TickerItem) => {
      const lane = Math.random() < 0.62 ? 0 : 1;
      setSlip({ ...item, lane, travelMs: PASS_MS });
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => {
        if (!stopped) setSlip((current) => (current?.id === item.id ? null : current));
      }, PASS_MS + 200);
    };

    const next = () => {
      if (stopped || items.length === 0) return;
      const index = cursor % items.length;
      const item = items[index];
      cursor += 1;
      show(item);
      timer = window.setTimeout(next, PASS_MS + waitMs(index === items.length - 1));
    };

    const load = async () => {
      try {
        const response = await fetch("/api/shop/ticker", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { items?: TickerItem[] };
        items = Array.isArray(body.items) ? body.items : [];
      } catch {
        items = [];
      }
      if (stopped || items.length === 0) return;
      timer = window.setTimeout(next, 1500);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) void load();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [hidden, pathname]);

  useEffect(() => {
    const node = slipRef.current;
    if (!node || !slip) return;
    const from = window.innerWidth;
    const to = -(node.offsetWidth + 32);
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / slip.travelMs);
      node.style.transform = `translateX(${from + (to - from) * t}px)`;
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [slip]);

  if (hidden) return null;

  return (
    <div className="shop-ticker" aria-hidden="true">
      {slip ? (
        <p
          key={`${slip.id}-${slip.lane}`}
          ref={slipRef}
          className={`shop-ticker-slip is-lane-${slip.lane}`}
        >
          <span>今天第 {slip.nth} 位</span>
          <span>买了 {slip.name}</span>
          <span>今天已售 {slip.soldToday}</span>
          <span>{stockLine(slip)}</span>
          <span className="shop-ticker-wish">{GREETING}</span>
        </p>
      ) : null}
    </div>
  );
}
