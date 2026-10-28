"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(ScrollTrigger, CustomEase);

const EASE = CustomEase.create("coke-base", "M0,0 C0.22,1 0.36,1 1,1");

function isPublicPath(pathname: string) {
  return !pathname.startsWith("/dashboard") && !pathname.startsWith("/admin");
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MotionLayer() {
  const pathname = usePathname();
  const progressRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const wipeActive = useRef(false);
  const firstRender = useRef(true);
  const publicRoute = isPublicPath(pathname);

  // Cover the viewport as soon as an internal public link is clicked. The
  // navigation itself is never intercepted, so Next's router and prefetching
  // keep working exactly as before.
  useEffect(() => {
    if (!publicRoute || prefersReducedMotion()) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      if (!isPublicPath(url.pathname)) return;

      wipeActive.current = true;
      gsap.to(wipeRef.current, {
        y: 0,
        duration: 0.3,
        ease: EASE,
        overwrite: true,
      });
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [publicRoute]);

  // Finish the wipe after the new route has rendered, then clean it up.
  useEffect(() => {
    const wipe = wipeRef.current;

    if (!publicRoute) {
      if (wipe) gsap.set(wipe, { y: window.innerHeight });
      wipeActive.current = false;
      firstRender.current = false;
      return;
    }

    if (firstRender.current) {
      firstRender.current = false;
      if (wipe) gsap.set(wipe, { y: window.innerHeight });
      return;
    }

    if (prefersReducedMotion()) {
      if (wipe) gsap.set(wipe, { y: window.innerHeight });
      wipeActive.current = false;
      return;
    }

    if (!wipeActive.current) {
      if (wipe) gsap.set(wipe, { y: window.innerHeight });
      return;
    }

    wipeActive.current = false;
    if (!wipe) return;

    const timeline = gsap.timeline();
    timeline
      .set(wipe, { y: 0 })
      .to(wipe, { y: -window.innerHeight, duration: 0.65, ease: EASE }, 0.05)
      .set(wipe, { y: window.innerHeight }, 1)
      .fromTo(
        "#main-content",
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.65, ease: EASE },
        0.1,
      );

    return () => {
      timeline.kill();
    };
  }, [pathname, publicRoute]);

  useEffect(() => {
    if (!publicRoute || prefersReducedMotion()) return;

    const disposers: Array<() => void> = [];
    let context: gsap.Context | null = null;
    let cancelled = false;

    const setup = () => {
      if (cancelled) return;

      context = gsap.context(() => {
        // Thin reading progress line under the floating navigation.
        if (progressRef.current) {
          gsap.set(progressRef.current, { scaleX: 0 });
          ScrollTrigger.create({
            start: 0,
            end: () => ScrollTrigger.maxScroll(window),
            onUpdate: (self) => {
              gsap.set(progressRef.current, { scaleX: self.progress });
            },
          });
        }

        // Billing bars fill once when the panel enters view.
        const bars = gsap.utils.toArray<HTMLElement>(".usage-track i");
        if (bars.length > 0) {
          gsap.set(bars, { transformOrigin: "left center", scaleX: 0 });
          gsap.to(bars, {
            scaleX: 1,
            duration: 0.8,
            stagger: 0.12,
            ease: EASE,
            scrollTrigger: {
              trigger: ".usage-panel",
              start: "top 85%",
              once: true,
            },
          });
        }

        // Magnetic primary actions on devices with a real pointer.
        if (window.matchMedia("(pointer: fine)").matches) {
          const buttons = gsap.utils.toArray<HTMLElement>(
            ".home-hero .btn-primary, .cta-card .btn-primary",
          );
          buttons.forEach((button) => {
            const xTo = gsap.quickTo(button, "x", {
              duration: 0.5,
              ease: EASE,
            });
            const yTo = gsap.quickTo(button, "y", {
              duration: 0.5,
              ease: EASE,
            });

            const onMove = (event: PointerEvent) => {
              if (event.pointerType !== "mouse") return;
              const rect = button.getBoundingClientRect();
              xTo((event.clientX - (rect.left + rect.width / 2)) * 0.12);
              yTo((event.clientY - (rect.top + rect.height / 2)) * 0.2);
            };
            const onLeave = () => {
              xTo(0);
              yTo(0);
            };

            button.addEventListener("pointermove", onMove);
            button.addEventListener("pointerleave", onLeave);
            disposers.push(() => {
              button.removeEventListener("pointermove", onMove);
              button.removeEventListener("pointerleave", onLeave);
            });
          });
        }

        // Covers drift slightly with the pointer, without tilting the card
        // itself, so the existing hover lift stays intact.
        if (window.matchMedia("(pointer: fine)").matches) {
          gsap.utils.toArray<HTMLElement>(".shop-product-card").forEach((card) => {
            const cover = card.querySelector<HTMLElement>(".shop-cover");
            const label = card.querySelector<HTMLElement>(".shop-cover-label");
            const orbit = card.querySelector<HTMLElement>(".shop-cover-orbit");
            if (!cover || (!label && !orbit)) return;

            const labelX = label
              ? gsap.quickTo(label, "x", { duration: 0.5, ease: EASE })
              : null;
            const labelY = label
              ? gsap.quickTo(label, "y", { duration: 0.5, ease: EASE })
              : null;
            const orbitX = orbit
              ? gsap.quickTo(orbit, "x", { duration: 0.5, ease: EASE })
              : null;
            const orbitY = orbit
              ? gsap.quickTo(orbit, "y", { duration: 0.5, ease: EASE })
              : null;

            const onMove = (event: PointerEvent) => {
              if (event.pointerType !== "mouse") return;
              const rect = cover.getBoundingClientRect();
              const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
              const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
              labelX?.(dx * -8);
              labelY?.(dy * -5);
              orbitX?.(dx * 14);
              orbitY?.(dy * 10);
            };
            const onLeave = () => {
              labelX?.(0);
              labelY?.(0);
              orbitX?.(0);
              orbitY?.(0);
            };

            card.addEventListener("pointermove", onMove);
            card.addEventListener("pointerleave", onLeave);
            disposers.push(() => {
              card.removeEventListener("pointermove", onMove);
              card.removeEventListener("pointerleave", onLeave);
            });
          });
        }
      }, document.body);
    };

    // Split immediately so the hero does not flash, then refresh once the
    // self-hosted font has settled.
    setup();
    document.fonts?.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      disposers.forEach((dispose) => dispose());
      context?.revert();
    };
  }, [pathname, publicRoute]);

  return (
    <>
      <div ref={progressRef} className="scroll-progress" aria-hidden="true" />
      <div ref={wipeRef} className="page-wipe" aria-hidden="true">
        <div className="page-wipe-inner">
          <span className="page-wipe-mark">C</span>
          <span>CokeAI.</span>
        </div>
      </div>
    </>
  );
}
