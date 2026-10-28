"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(ScrollTrigger, CustomEase);
const EASE = CustomEase.create("coke-base", "M0,0 C0.22,1 0.36,1 1,1");

const LINES = [
  ["一个", "接口，", "接上", "你常用的", "模型。"],
  ["每一笔", "用量，", "都", "算得", "清楚。"],
];

const WORDS = LINES.flat();
const FULL_TEXT = WORDS.join("");

export function TaglineReveal() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const section = sectionRef.current;
    const words = wordRefs.current.filter(
      (word): word is HTMLSpanElement => Boolean(word),
    );
    if (!section || words.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = gsap.context(() => {
      gsap.to(words, {
        color: "rgb(22, 22, 21)",
        duration: 0.5,
        ease: EASE,
        stagger: 0.08,
        scrollTrigger: {
          trigger: section,
          start: "top 72%",
          once: true,
        },
      });
    }, section);

    return () => context.revert();
  }, []);

  let wordIndex = 0;

  return (
    <section
      ref={sectionRef}
      className="tagline-section"
      aria-labelledby="tagline-title"
    >
      <div className="container tagline-inner">
        <div className="tagline-kicker">Why CokeAI</div>
        <h2 className="tagline" id="tagline-title" aria-label={FULL_TEXT}>
          {LINES.map((line, lineIndex) => (
            <span className="tagline-line" key={line.join("")} aria-hidden="true">
              {line.map((word) => {
                const index = wordIndex;
                wordIndex += 1;
                return (
                  <span
                    key={`${lineIndex}-${index}`}
                    ref={(node) => {
                      wordRefs.current[index] = node;
                    }}
                    className="tagline-word"
                  >
                    {word}
                  </span>
                );
              })}
            </span>
          ))}
        </h2>
      </div>
    </section>
  );
}
