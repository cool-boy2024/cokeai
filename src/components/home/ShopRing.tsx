"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import type { PublicShopProduct } from "@/lib/shop/catalog";
// variants.ts is pure; catalog.ts pulls the database client, which must not
// reach this client component's browser bundle.
import { startingPriceMicros } from "@/lib/shop/variants";
import { productPriceLabel } from "@/lib/shop/copy";
import { ProductCover } from "@/components/shop/ProductCover";

gsap.registerPlugin(ScrollTrigger, CustomEase);

const EASE = CustomEase.create("coke-ring", "M0,0 C0.22,1 0.36,1 1,1");
const TAU = Math.PI * 2;

export function ShopRing({ products }: { products: PublicShopProduct[] }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    const items = itemsRef.current.filter(
      (item): item is HTMLDivElement => Boolean(item),
    );
    if (!stage || !layer || items.length < 2) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const section = stage.closest<HTMLElement>(".shop-collection");
    const state = { time: 0, scroll: 0, hold: reduced ? 1 : 0 };
    const expand: Record<number, number> = {};
    items.forEach((_, index) => {
      expand[index] = reduced ? 1 : 0;
    });
    const metrics = { rx: 0, ry: 0 };

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      metrics.rx = Math.min(rect.width * 0.38, 600);
      metrics.ry = Math.min(rect.height * 0.33, 262);
    };
    measure();

    const place = () => {
      if (metrics.rx === 0) return;
      const spin = state.time * 0.085 + state.scroll * 1.15;
      items.forEach((item, index) => {
        const base = (index / items.length) * TAU - Math.PI / 2;
        const angle = base + spin;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const depth = (sin + 1) / 2;
        const grow = expand[index];
        const factor = 0.72 + 0.28 * grow;
        const x = cos * metrics.rx * factor;
        const y = sin * metrics.ry * factor;
        const scale = (0.8 + 0.24 * depth) * (0.9 + 0.1 * grow);
        const tilt = cos * 16 + (index % 2 === 0 ? 4 : -4);

        item.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(
          1,
        )}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        item.style.opacity = String((0.5 + 0.5 * depth) * grow);
        item.style.zIndex = String(
          Math.round(scale * 100) + (item.dataset.hover === "1" ? 400 : 0),
        );
      });
    };

    if (reduced) {
      place();
      const onResize = () => {
        measure();
        place();
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const tick = () => {
      const seconds = gsap.ticker.deltaRatio(60) / 60;
      state.time += seconds * (1 - state.hold);
      place();
    };
    gsap.ticker.add(tick);

    const intro: gsap.core.Tween[] = [];
    const playIntro = () => {
      items.forEach((_, index) => {
        intro.push(
          gsap.to(expand, {
            [index]: 1,
            duration: 1,
            ease: EASE,
            delay: 0.08 + index * 0.05,
          }),
        );
      });
    };
    const revealTrigger = ScrollTrigger.create({
      trigger: stage,
      start: "top 78%",
      once: true,
      onEnter: playIntro,
    });

    const scrollTrigger = ScrollTrigger.create({
      trigger: stage,
      start: "top bottom",
      end: "bottom top",
      onUpdate: (self) => {
        state.scroll = self.progress;
      },
    });

    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);

    let disposePointer = () => {};

    if (section && window.matchMedia("(pointer: fine)").matches) {
      const layerY = gsap.quickTo(layer, "rotationY", {
        duration: 1.2,
        ease: EASE,
      });
      const layerX = gsap.quickTo(layer, "rotationX", {
        duration: 1.2,
        ease: EASE,
      });

      const onMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const dx = event.clientX / window.innerWidth - 0.5;
        const dy = event.clientY / window.innerHeight - 0.5;
        layerY(dx * 6);
        layerX(-dy * 4);
      };
      const pause = () => {
        gsap.to(state, { hold: 1, duration: 0.35, ease: EASE, overwrite: true });
      };
      const resume = () => {
        gsap.to(state, { hold: 0, duration: 0.7, ease: EASE, overwrite: true });
      };
      const onSectionLeave = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        layerY(0);
        layerX(0);
      };

      section.addEventListener("pointermove", onMove);
      section.addEventListener("pointerleave", onSectionLeave);

      // Pause only while a card is hovered or focused. Pausing on the whole
      // section left the ring static whenever the cursor rested anywhere on
      // the page, which is the normal desktop position.
      const itemDisposers: Array<() => void> = [];
      items.forEach((item) => {
        item.addEventListener("pointerenter", pause);
        item.addEventListener("pointerleave", resume);
        item.addEventListener("focusin", pause);
        item.addEventListener("focusout", resume);
        itemDisposers.push(() => {
          item.removeEventListener("pointerenter", pause);
          item.removeEventListener("pointerleave", resume);
          item.removeEventListener("focusin", pause);
          item.removeEventListener("focusout", resume);
        });
      });

      disposePointer = () => {
        section.removeEventListener("pointermove", onMove);
        section.removeEventListener("pointerleave", onSectionLeave);
        itemDisposers.forEach((dispose) => dispose());
        gsap.killTweensOf(state);
      };
    }

    return () => {
      gsap.ticker.remove(tick);
      intro.forEach((tween) => tween.kill());
      revealTrigger.kill();
      scrollTrigger.kill();
      observer.disconnect();
      disposePointer();
      gsap.killTweensOf(state);
      gsap.killTweensOf(layer);
    };
  }, []);

  return (
    <div ref={stageRef} className="shop-ring-stage">
      <span className="shop-ring-guide" aria-hidden="true" />
      <span className="shop-ring-guide shop-ring-guide-b" aria-hidden="true" />
      <div ref={layerRef} className="shop-ring-layer">
        {products.map((product, index) => (
          <div
            key={product.id}
            ref={(node) => {
              itemsRef.current[index] = node;
            }}
            className="shop-ring-item"
            data-hover="0"
            onPointerEnter={(event) => {
              event.currentTarget.dataset.hover = "1";
            }}
            onPointerLeave={(event) => {
              event.currentTarget.dataset.hover = "0";
            }}
            onFocus={() => {
              const item = itemsRef.current[index];
              if (item) item.dataset.hover = "1";
            }}
            onBlur={() => {
              const item = itemsRef.current[index];
              if (item) item.dataset.hover = "0";
            }}
          >
            <Link href={`/shop/${product.slug}`} className="shop-ring-card">
              <ProductCover
                variant={product.cover_variant}
                brand={product.brand}
                imageUrl={product.image_url}
                sizes="180px"
              />
              <div className="shop-ring-body">
                <span className="shop-ring-brand">
                  {product.brand.toUpperCase()}
                </span>
                <span className="shop-ring-name">{product.name}</span>
                <span className="shop-ring-price">
                  {productPriceLabel(startingPriceMicros(product))}
                  {product.variants.length > 0 ? (
                    <em className="shop-price-from">起</em>
                  ) : null}
                </span>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
