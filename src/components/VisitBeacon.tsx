"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createVisitorId, VISITOR_COOKIE } from "@/lib/visits-format";

const SKIP_PREFIXES = ["/admin", "/dashboard", "/api", "/v1"];

function hasVisitorCookie(): boolean {
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${VISITOR_COOKIE}=`));
}

/**
 * Records one anonymous first visit per browser. Mounted on every page, but
 * skips the authenticated consoles and API routes, and does nothing after the
 * visitor cookie exists. React StrictMode runs effects twice in development;
 * the ref keeps the request single-shot.
 */
export function VisitBeacon() {
  const pathname = usePathname();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || typeof window === "undefined") return;
    if (navigator.webdriver) return;
    if ((document.visibilityState as string) === "prerender") return;
    if (SKIP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return;
    }
    if (hasVisitorCookie()) return;

    sent.current = true;
    fetch("/api/track/visit", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitorId: createVisitorId(),
        landingPath: window.location.pathname,
        referrer: document.referrer,
      }),
    }).catch(() => {
      // Tracking must never affect the page.
    });
  }, [pathname]);

  return null;
}
