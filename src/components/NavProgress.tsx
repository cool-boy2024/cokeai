"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type ProgressState = "idle" | "loading" | "done";

export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<ProgressState>("idle");
  const previousPath = useRef(pathname);
  const timer = useRef<number | null>(null);
  const appRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/dashboard");

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setState((current) => (current === "loading" ? "done" : "idle"));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [pathname]);

  useEffect(() => {
    if (!appRoute) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      if (anchor.dataset.noProgress === "true") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      setState("loading");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 12000);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [appRoute]);

  if (!appRoute) return null;

  return (
    <div
      className={`nav-progress${
        state === "loading"
          ? " is-loading"
          : state === "done"
            ? " is-done"
            : ""
      }`}
      aria-hidden="true"
    >
      <span />
    </div>
  );
}
