"use client";

import { useEffect, useRef } from "react";

const RING_COUNT = 9;

/**
 * Decorative space-tunnel backdrop for /login and /register.
 *
 * The rings and stars are animated entirely in CSS (transform/opacity only).
 * This component adds a small pointer parallax on fine pointers. Pointer
 * movement is ignored on touch devices and when the visitor asks for reduced
 * motion, leaving the static CSS backdrop in place.
 */
export function AuthTunnel() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const write = () => {
      root.style.setProperty("--auth-ring-x", `${(-currentX * 0.8).toFixed(2)}px`);
      root.style.setProperty("--auth-ring-y", `${(-currentY * 0.8).toFixed(2)}px`);
      root.style.setProperty("--auth-star-x", `${(currentX * 0.35).toFixed(2)}px`);
      root.style.setProperty("--auth-star-y", `${(currentY * 0.35).toFixed(2)}px`);
    };

    const reset = () => {
      targetX = 0;
      targetY = 0;
      currentX = 0;
      currentY = 0;
      write();
    };

    const settle = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      write();

      if (
        Math.abs(targetX - currentX) > 0.05 ||
        Math.abs(targetY - currentY) > 0.05
      ) {
        frame = requestAnimationFrame(settle);
      } else {
        frame = 0;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        !finePointer.matches ||
        reducedMotion.matches
      ) {
        return;
      }

      targetX = (event.clientX / window.innerWidth - 0.5) * 22;
      targetY = (event.clientY / window.innerHeight - 0.5) * 14;

      if (!frame) frame = requestAnimationFrame(settle);
    };

    const onPreferenceChange = () => {
      if (reducedMotion.matches) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        reset();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    reducedMotion.addEventListener("change", onPreferenceChange);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      reducedMotion.removeEventListener("change", onPreferenceChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="auth-tunnel" ref={rootRef} aria-hidden="true">
      <div className="auth-tunnel__glow" />
      <div className="auth-tunnel__rings">
        {Array.from({ length: RING_COUNT }, (_, index) => (
          <span
            key={index}
            className="auth-tunnel__ring"
            style={{ animationDelay: `${index * -1.55}s` }}
          />
        ))}
      </div>
      <div className="auth-tunnel__starfield">
        <div className="auth-tunnel__stars auth-tunnel__stars--far" />
        <div className="auth-tunnel__stars auth-tunnel__stars--near" />
      </div>
      <div className="auth-tunnel__vignette" />
      <div className="auth-tunnel__grain" />
    </div>
  );
}
