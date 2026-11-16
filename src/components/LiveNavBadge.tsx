"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** 多久向服务端确认一次未读数（毫秒）。 */
const POLL_MS = 60_000;

/**
 * Number badge for a sidebar link whose count changes while the operator is
 * already inside the section.
 *
 * The admin layout is a cached shell: it does not re-render when a ticket
 * detail page marks messages read, nor when a customer replies. So the badge
 * keeps its own copy of the count and refreshes it on every route change, when
 * the tab becomes visible again, and on a slow interval so a new customer
 * reply shows up without a manual reload.
 *
 * Rendered as a <span>: this sits inside the nav <a>, and an <a> inside an <a>
 * is invalid markup that breaks hydration.
 */
export function LiveNavBadge({
  count,
  endpoint = "/api/admin/support/unread",
}: {
  count: number;
  endpoint?: string;
}) {
  const pathname = usePathname();
  const [live, setLive] = useState(count);

  useEffect(() => {
    setLive(count);
  }, [count]);

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      if (document.visibilityState === "hidden") return;
      fetch(endpoint, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { count?: number } | null) => {
          if (!cancelled && data && typeof data.count === "number") {
            setLive(data.count);
          }
        })
        .catch(() => {
          // A failed badge refresh must never break navigation.
        });
    }

    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pathname, endpoint]);

  if (live <= 0) return null;
  return (
    <span
      className="sidebar-badge-live"
      aria-label={`${live > 99 ? "超过 99 个" : `${live} 个`}未读工单`}
    >
      {live > 99 ? "99+" : live}
    </span>
  );
}
