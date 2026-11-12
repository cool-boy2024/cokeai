"use client";

import { useEffect, useRef } from "react";

type OrbitConfig = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  z: number;
  zRange: number;
  scale: number;
  opacity: number;
  speed: number;
  phase: number;
};

type GalaxyItem = {
  name: string;
  src: string;
  desktop: OrbitConfig;
  mobile: OrbitConfig;
  desktopOnly?: boolean;
};

const orbit = (
  x: number,
  y: number,
  rx: number,
  ry: number,
  z: number,
  zRange: number,
  scale: number,
  opacity: number,
  speed: number,
  phase: number,
): OrbitConfig => ({ x, y, rx, ry, z, zRange, scale, opacity, speed, phase });

/**
 * Ten ecosystem marks arranged as a loose, slowly drifting constellation.
 * No logo grid, no labels and no pointer target: the scene is decorative.
 */
const GALAXY_ITEMS: GalaxyItem[] = [
  {
    name: "openai",
    src: "/brands/openai.svg",
    desktop: orbit(0.085, 0.17, 26, 16, 40, 34, 1.02, 0.92, 0.000052, 0.3),
    mobile: orbit(0.085, 0.155, 9, 5, 10, 12, 0.95, 0.92, 0.000052, 0.3),
  },
  {
    name: "claude",
    src: "/brands/claude.svg",
    desktop: orbit(0.035, 0.47, 14, 30, -90, 30, 0.82, 0.78, 0.000061, 2.1),
    mobile: orbit(0.3, 0.128, 7, 5, -20, 10, 0.8, 0.82, 0.000061, 2.1),
  },
  {
    name: "gemini",
    src: "/brands/gemini.svg",
    desktop: orbit(0.19, 0.82, 30, 14, 20, 26, 0.95, 0.85, 0.000047, 4.0),
    mobile: orbit(0.5, 0.162, 8, 5, 20, 12, 0.9, 0.9, 0.000047, 4.0),
  },
  {
    name: "grok",
    src: "/brands/grok.svg",
    desktop: orbit(0.3, 0.17, 18, 10, 100, 30, 1.08, 0.9, 0.000068, 1.2),
    mobile: orbit(0.715, 0.118, 7, 4, 30, 10, 0.82, 0.88, 0.000068, 1.2),
  },
  {
    name: "deepseek",
    src: "/brands/deepseek.svg",
    desktop: orbit(0.47, 0.19, 24, 18, -40, 34, 0.88, 0.82, 0.000056, 3.4),
    mobile: orbit(0.91, 0.152, 8, 5, 10, 12, 0.9, 0.9, 0.000056, 3.4),
  },
  {
    name: "qwen",
    src: "/brands/qwen.svg",
    desktop: orbit(0.6, 0.17, 16, 12, 70, 22, 0.82, 0.8, 0.000073, 5.0),
    mobile: orbit(0.12, 0.93, 8, 5, 15, 10, 0.82, 0.84, 0.000073, 5.0),
  },
  {
    name: "kimi",
    src: "/brands/kimi.svg",
    desktop: orbit(0.915, 0.27, 12, 22, 30, 26, 1.05, 0.9, 0.000049, 0.9),
    mobile: orbit(0.32, 0.96, 9, 4, -10, 10, 0.78, 0.82, 0.000049, 0.9),
  },
  {
    name: "mistral",
    src: "/brands/mistral.svg",
    desktop: orbit(0.955, 0.61, 10, 30, -110, 30, 0.86, 0.72, 0.000066, 2.8),
    mobile: orbit(0.6, 0.93, 8, 5, 20, 10, 0.82, 0.84, 0.000066, 2.8),
  },
  {
    name: "meta",
    src: "/brands/meta.svg",
    desktop: orbit(0.78, 0.91, 26, 10, 60, 24, 0.9, 0.8, 0.000058, 4.7),
    mobile: orbit(0.6, 0.93, 8, 5, 20, 10, 0.82, 0.84, 0.000066, 2.8),
    desktopOnly: true,
  },
  {
    name: "ollama",
    src: "/brands/ollama.svg",
    desktop: orbit(0.56, 0.88, 20, 12, -60, 26, 0.8, 0.72, 0.000071, 1.7),
    mobile: orbit(0.6, 0.93, 8, 5, 20, 10, 0.82, 0.84, 0.000066, 2.8),
    desktopOnly: true,
  },
];

export function AuthGalaxy() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileLayout = window.matchMedia("(max-width: 860px)");
    let frame = 0;
    let running = false;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const draw = (time: number, still: boolean) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const mobile = mobileLayout.matches;

      GALAXY_ITEMS.forEach((item, index) => {
        const slot = slotRefs.current[index];
        if (!slot || slot.offsetParent === null) return;

        const chip = slot.firstElementChild as HTMLElement | null;
        if (!chip) return;

        const view = mobile ? item.mobile : item.desktop;
        const t = still ? view.phase : time * view.speed + view.phase;
        const orbitX = Math.cos(t) * view.rx;
        const orbitY = Math.sin(t * 1.12) * view.ry;
        const x = view.x * vw + orbitX + currentX * view.scale;
        const y = view.y * vh + orbitY + currentY * view.scale;
        const z =
          view.z + Math.sin(t * 0.8 + view.phase) * (still ? 0 : view.zRange);
        const scale =
          view.scale *
          (1 + (still ? 0 : Math.sin(t * 0.9 + 0.5) * 0.03));
        const opacity =
          view.opacity *
          (still ? 1 : 0.88 + 0.12 * Math.sin(t * 1.1 + view.phase));

        slot.style.transform = `translate3d(calc(${x.toFixed(
          2,
        )}px - 50%), calc(${y.toFixed(2)}px - 50%), ${z.toFixed(1)}px)`;
        slot.style.opacity = opacity.toFixed(2);
        chip.style.transform = `scale(${scale.toFixed(3)}) rotate(${(
          Math.sin(t * 0.6) * 2
        ).toFixed(2)}deg)`;
      });
    };

    const tick = (now: number) => {
      if (!running) return;
      currentX += (targetX - currentX) * 0.065;
      currentY += (targetY - currentY) * 0.065;
      draw(now, false);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || reducedMotion.matches) return;
      running = true;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const placeStill = () => {
      currentX = 0;
      currentY = 0;
      draw(0, true);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        !finePointer.matches ||
        reducedMotion.matches
      ) {
        return;
      }
      targetX = (event.clientX / window.innerWidth - 0.5) * 18;
      targetY = (event.clientY / window.innerHeight - 0.5) * 12;
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
    };

    const onPreferenceChange = () => {
      if (reducedMotion.matches) {
        stop();
        placeStill();
      } else {
        start();
      }
    };

    if (reducedMotion.matches) {
      placeStill();
    } else {
      placeStill();
      start();
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);
    reducedMotion.addEventListener("change", onPreferenceChange);

    return () => {
      stop();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      reducedMotion.removeEventListener("change", onPreferenceChange);
    };
  }, []);

  return (
    <div className="auth-galaxy" ref={rootRef} aria-hidden="true">
      <div className="auth-galaxy__glow" />
      <div className="auth-galaxy__dust" />
      <div className="auth-galaxy__scene">
        <span className="auth-galaxy__orbit auth-galaxy__orbit--a" />
        <span className="auth-galaxy__orbit auth-galaxy__orbit--b" />
        <span className="auth-galaxy__orbit auth-galaxy__orbit--c" />
        <div className="auth-galaxy__layer">
          {GALAXY_ITEMS.map((item, index) => (
            <div
              key={item.name}
              ref={(element) => {
                slotRefs.current[index] = element;
              }}
              className={`auth-galaxy__slot${
                item.desktopOnly ? " auth-galaxy__slot--desktop-only" : ""
              }`}
            >
              <span className="auth-galaxy__chip">
                <img src={item.src} alt="" width={24} height={24} draggable={false} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="auth-galaxy__grain" />
    </div>
  );
}
