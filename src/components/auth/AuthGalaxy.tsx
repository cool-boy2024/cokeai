"use client";

import { useEffect, useRef, type CSSProperties } from "react";

type MarkView = {
  /** Screen position at depth 0, as a fraction of the viewport. */
  x: number;
  y: number;
  /** Small side-to-side drift, in px of world space. */
  driftX: number;
  driftY: number;
  /** Milliseconds for one far-to-near traversal. */
  cycle: number;
  /** 0..1 offset into the traversal. */
  phase: number;
  scale: number;
  opacity: number;
  zFar: number;
  zNear: number;
};

type GalaxyItem = {
  name: string;
  src: string;
  desktop: MarkView;
  mobile: MarkView;
  desktopOnly?: boolean;
};

const mark = (
  x: number,
  y: number,
  cycle: number,
  phase: number,
  scale: number,
  opacity: number,
  zFar: number,
  zNear: number,
  driftX = 10,
  driftY = 8,
): MarkView => ({
  x,
  y,
  cycle,
  phase,
  scale,
  opacity,
  zFar,
  zNear,
  driftX,
  driftY,
});

/**
 * Ten ecosystem marks flying through the light tunnel. Each mark starts deep
 * at the vanishing point, then travels towards the viewer: its offset from the
 * tunnel axis grows with depth, so it sweeps outwards and grows at the same
 * time, fading in at the far end and out as it passes the camera.
 * The scene is decorative: no labels, no links, no pointer targets.
 */
const GALAXY_ITEMS: GalaxyItem[] = [
  {
    name: "openai",
    src: "/brands/openai.svg",
    desktop: mark(0.09, 0.16, 14200, 0.08, 1.0, 0.9, -900, 500, 14, 10),
    mobile: mark(0.14, 0.1, 12800, 0.08, 0.96, 0.9, -620, 320, 6, 4),
  },
  {
    name: "claude",
    src: "/brands/claude.svg",
    desktop: mark(0.18, 0.58, 16400, 0.22, 0.9, 0.82, -900, 500, 10, 13),
    mobile: mark(0.33, 0.145, 13600, 0.22, 0.9, 0.86, -620, 320, 5, 4),
  },
  {
    name: "gemini",
    src: "/brands/gemini.svg",
    desktop: mark(0.33, 0.86, 12800, 0.36, 0.96, 0.86, -900, 500, 12, 9),
    mobile: mark(0.56, 0.085, 11600, 0.36, 0.92, 0.9, -620, 320, 6, 3),
  },
  {
    name: "grok",
    src: "/brands/grok.svg",
    desktop: mark(0.42, 0.12, 15100, 0.5, 1.02, 0.88, -900, 500, 11, 10),
    mobile: mark(0.76, 0.14, 12400, 0.5, 0.9, 0.86, -620, 320, 5, 4),
  },
  {
    name: "deepseek",
    src: "/brands/deepseek.svg",
    desktop: mark(0.52, 0.9, 17300, 0.64, 0.92, 0.84, -900, 500, 13, 9),
    mobile: mark(0.92, 0.1, 13200, 0.64, 0.88, 0.84, -620, 320, 5, 3),
  },
  {
    name: "qwen",
    src: "/brands/qwen.svg",
    desktop: mark(0.92, 0.2, 11900, 0.15, 0.92, 0.84, -900, 500, 9, 11),
    mobile: mark(0.035, 0.44, 14600, 0.15, 0.82, 0.78, -620, 320, 4, 7),
  },
  {
    name: "kimi",
    src: "/brands/kimi.svg",
    desktop: mark(0.885, 0.58, 13700, 0.44, 1.04, 0.9, -900, 500, 10, 10),
    mobile: mark(0.965, 0.56, 13900, 0.44, 0.82, 0.78, -620, 320, 4, 7),
  },
  {
    name: "mistral",
    src: "/brands/mistral.svg",
    desktop: mark(0.9, 0.88, 15900, 0.58, 0.9, 0.78, -900, 500, 9, 9),
    mobile: mark(0.18, 0.93, 15200, 0.58, 0.84, 0.82, -620, 320, 5, 4),
  },
  {
    name: "meta",
    src: "/brands/meta.svg",
    desktop: mark(0.82, 0.08, 13100, 0.7, 0.94, 0.84, -900, 500, 8, 7),
    mobile: mark(0.83, 0.94, 14300, 0.7, 0.84, 0.82, -620, 320, 5, 4),
  },
  {
    name: "muse",
    src: "/brand/muse-logo.svg",
    desktop: mark(0.965, 0.4, 16800, 0.32, 0.98, 0.86, -900, 500, 7, 11),
    mobile: mark(0.52, 0.955, 16000, 0.32, 0.84, 0.82, -620, 320, 5, 4),
  },
];

const TUNNEL_RINGS = Array.from({ length: 12 }, (_, index) => index);

const TUNNEL_STREAKS = [
  { angle: -171, delay: -0.1, length: 210 },
  { angle: -142, delay: -0.55, length: 150 },
  { angle: -108, delay: -1.05, length: 260 },
  { angle: -74, delay: -1.6, length: 170 },
  { angle: -38, delay: -2.1, length: 230 },
  { angle: 2, delay: -2.65, length: 190 },
  { angle: 37, delay: -3.1, length: 160 },
  { angle: 74, delay: -3.55, length: 250 },
  { angle: 112, delay: -4.0, length: 175 },
  { angle: 148, delay: -4.4, length: 220 },
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
      const originX = vw * (mobile ? 0.5 : 0.64);
      const originY = vh * (mobile ? 0.18 : 0.45);
      const perspective = mobile ? 760 : 1200;

      GALAXY_ITEMS.forEach((item, index) => {
        const slot = slotRefs.current[index];
        if (!slot || slot.offsetParent === null) return;

        const chip = slot.firstElementChild as HTMLElement | null;
        if (!chip) return;

        const view = mobile ? item.mobile : item.desktop;
        const p = still
          ? view.phase
          : (((time / view.cycle + view.phase) % 1) + 1) % 1;
        const z = view.zFar + (view.zNear - view.zFar) * p;
        const wobble = still ? 0 : time * 0.00042;
        const driftScale = still ? 0.35 : 1;
        // World-space offset from the tunnel axis. At depth 0 the mark sits on
        // its designed screen point; as z rises the perspective projection
        // pushes it outwards and makes it larger, which is what produces the
        // fly-through motion rather than a flat orbit.
        const worldX =
          view.x * vw +
          Math.cos(wobble + view.phase * 6.2) *
            view.driftX *
            driftScale +
          currentX;
        const worldY =
          view.y * vh +
          Math.sin(wobble * 0.9 + view.phase * 5.4) *
            view.driftY *
            driftScale +
          currentY;
        const fade = Math.max(
          0,
          Math.min(1, p / 0.14, (1 - p) / 0.24),
        );

        slot.style.transform = `translate3d(calc(${worldX.toFixed(
          2,
        )}px - 50%), calc(${worldY.toFixed(2)}px - 50%), ${z.toFixed(1)}px)`;
        slot.style.opacity = (view.opacity * fade).toFixed(3);

        const pulse = still
          ? 1
          : 1 + Math.sin(time * 0.0005 + view.phase * 7) * 0.025;
        const tilt = still
          ? 0
          : Math.sin(time * 0.00035 + view.phase * 4) * 1.8;
        chip.style.transform = `scale(${(view.scale * pulse).toFixed(
          3,
        )}) rotate(${tilt.toFixed(2)}deg)`;
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

    const onResize = () => {
      if (reducedMotion.matches) placeStill();
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
    window.addEventListener("resize", onResize, { passive: true });
    reducedMotion.addEventListener("change", onPreferenceChange);

    return () => {
      stop();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      window.removeEventListener("resize", onResize);
      reducedMotion.removeEventListener("change", onPreferenceChange);
    };
  }, []);

  return (
    <div className="auth-galaxy" ref={rootRef} aria-hidden="true">
      <div className="auth-galaxy__glow" />
      <div className="auth-galaxy__dust" />
      <div className="auth-galaxy__scene">
        <div className="auth-tunnel__core" />
        <div className="auth-tunnel__rings">
          {TUNNEL_RINGS.map((index) => (
            <span
              key={index}
              className={`auth-tunnel__ring${
                index % 3 === 0 ? " auth-tunnel__ring--accent" : ""
              }`}
              style={{ "--ring-index": index } as CSSProperties}
            />
          ))}
        </div>
        <div className="auth-tunnel__streaks">
          {TUNNEL_STREAKS.map((streak, index) => (
            <span
              key={index}
              className="auth-tunnel__streak"
              style={
                {
                  "--streak-angle": `${streak.angle}deg`,
                  "--streak-delay": `${streak.delay}s`,
                  "--streak-length": `${streak.length}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
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
                <img
                  src={item.src}
                  alt=""
                  width={24}
                  height={24}
                  draggable={false}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="auth-galaxy__grain" />
    </div>
  );
}
