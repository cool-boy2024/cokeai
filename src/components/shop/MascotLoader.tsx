"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ShopMascots = dynamic(
  () => import("./ShopMascots").then((mod) => mod.ShopMascots),
  { ssr: false, loading: () => null },
);

/** 空闲回调迟迟不来时的兜底时间。 */
const IDLE_FALLBACK_MS = 2500;

/**
 * 桌宠是 2000+ 行的 DOM 动画组件，放在根 layout 会顶进首屏的水合任务里。
 * 等浏览器空闲、或用户先有点击 / 滚动再挂载，首屏先让出来。
 * 跨页护送不依赖挂载时机：ShopMascots 自己比 pathname 决定入场。
 */
export function MascotLoader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 手机会话里桌宠既不能跳也不该占 JS：直接不挂载（CSS 另有一层兜底）。
    if (window.matchMedia("(max-width: 767px)").matches) return;
    let idleHandle: number | null = null;
    let timer = 0;
    let triggered = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      idleHandle = null;
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("scroll", start);
    };

    function start() {
      if (triggered) return;
      triggered = true;
      cleanup();
      setMounted(true);
    }

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(start, { timeout: IDLE_FALLBACK_MS });
    } else {
      timer = window.setTimeout(start, IDLE_FALLBACK_MS);
    }
    window.addEventListener("pointerdown", start, { passive: true });
    window.addEventListener("scroll", start, { passive: true });

    return () => {
      triggered = true;
      cleanup();
    };
  }, []);

  return mounted ? <ShopMascots /> : null;
}
