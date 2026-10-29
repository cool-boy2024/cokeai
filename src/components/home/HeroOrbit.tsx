"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import { BRAND_MARKS } from "./brandMarks";

gsap.registerPlugin(ScrollTrigger, CustomEase);

const EASE = CustomEase.create("coke-orbit", "M0,0 C0.22,1 0.36,1 1,1");
const TAU = Math.PI * 2;

export function HeroOrbit() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    const items = itemsRef.current.filter(
      (item): item is HTMLDivElement => Boolean(item),
    );
    if (!stage || !layer || items.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state = { expand: reduced ? 1 : 0, scroll: 0 };
    const metrics = { rx: 0, ry: 0 };

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      metrics.rx = Math.min(rect.width * 0.42, 600);
      metrics.ry = Math.min(rect.height * 0.4, 320);
    };
    measure();

    const place = (time: number) => {
      if (metrics.rx === 0) return;

      const factor = (0.8 + 0.2 * state.expand) * (1 - 0.35 * state.scroll);
      const fade = state.expand * Math.max(0, 1 - state.scroll * 1.9);

      items.forEach((item, index) => {
        const base = (index / items.length) * TAU - Math.PI / 2;
        const angle = base + time * 0.06;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const depth = (sin + 1) / 2;
        const x = cos * metrics.rx * factor;
        const y =
          sin * metrics.ry * factor +
          Math.sin(time * 0.9 + index * 1.7) * 4;
        const scale = (0.72 + 0.3 * depth) * (0.94 + 0.06 * state.expand);

        item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(
          1,
        )}px, 0) rotate(${(cos * 8).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        item.style.opacity = ((0.42 + 0.58 * depth) * fade).toFixed(3);
        item.style.zIndex = String(Math.round(scale * 100));
      });
    };

    if (reduced) {
      place(0);
      const onResize = () => {
        measure();
        place(0);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const startTime = gsap.ticker.time;
    const tick = () => place(gsap.ticker.time - startTime);
    gsap.ticker.add(tick);

    const intro = gsap.to(state, {
      expand: 1,
      duration: 1.2,
      ease: EASE,
      delay: 0.15,
    });

    const hero = stage.closest<HTMLElement>(".home-hero");
    const trigger = hero
      ? ScrollTrigger.create({
          trigger: hero,
          start: "top top",
          end: "bottom top",
          onUpdate: (self) => {
            state.scroll = self.progress;
          },
        })
      : null;

    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);

    let disposePointer = () => {};

    if (hero && window.matchMedia("(pointer: fine)").matches) {
      const center = hero.querySelector<HTMLElement>(".hero-center");
      const layerX = gsap.quickTo(layer, "x", { duration: 0.9, ease: EASE });
      const layerY = gsap.quickTo(layer, "y", { duration: 0.9, ease: EASE });
      const layerRX = gsap.quickTo(layer, "rotationX", {
        duration: 1,
        ease: EASE,
      });
      const layerRY = gsap.quickTo(layer, "rotationY", {
        duration: 1,
        ease: EASE,
      });
      const centerX = center
        ? gsap.quickTo(center, "x", { duration: 0.9, ease: EASE })
        : null;
      const centerY = center
        ? gsap.quickTo(center, "y", { duration: 0.9, ease: EASE })
        : null;

      const onMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const dx = event.clientX / window.innerWidth - 0.5;
        const dy = event.clientY / window.innerHeight - 0.5;
        layerX(dx * -20);
        layerY(dy * -12);
        layerRX(-dy * 5);
        layerRY(dx * 7);
        centerX?.(dx * -8);
        centerY?.(dy * -5);
      };
      const onLeave = () => {
        layerX(0);
        layerY(0);
        layerRX(0);
        layerRY(0);
        centerX?.(0);
        centerY?.(0);
      };

      hero.addEventListener("pointermove", onMove);
      hero.addEventListener("pointerleave", onLeave);
      disposePointer = () => {
        hero.removeEventListener("pointermove", onMove);
        hero.removeEventListener("pointerleave", onLeave);
      };
    }

    return () => {
      gsap.ticker.remove(tick);
      intro.kill();
      trigger?.kill();
      observer.disconnect();
      disposePointer();
    };
  }, []);

  return (
    <div ref={stageRef} className="hero-orbit-stage" aria-hidden="true">
      <div ref={layerRef} className="hero-orbit-layer">
        {BRAND_MARKS.map((mark, index) => (
          <div
            key={mark.name}
            ref={(node) => {
              itemsRef.current[index] = node;
            }}
            className="orbit-item"
          >
            <div className="orbit-card">
              <img
                src={mark.file}
                alt=""
                width={30}
                height={30}
                draggable={false}
                decoding="async"
              />
              <span>{mark.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
