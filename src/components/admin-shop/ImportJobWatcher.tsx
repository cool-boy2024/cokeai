"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type JobStatus = {
  status: string;
  productId: string | null;
  error: string | null;
};

const MAX_POLLS = 120;
const POLL_MS = 2_500;

/**
 * Keeps the sources page fresh while AI listing jobs run. It polls a tiny JSON
 * endpoint instead of re-rendering the whole offer table, and jumps to the
 * product editor once a draft (or an existing product) is ready.
 */
export function ImportJobWatcher({
  jobId,
  pending,
}: {
  jobId?: string | null;
  pending: number;
}) {
  const router = useRouter();
  const pendingRef = useRef(pending);
  const active = pending > 0;

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // Depend on the 0 -> >0 transition rather than every count change: a refresh
  // must not reset the polling budget or restart the initial delay.
  useEffect(() => {
    if (!jobId && !active) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let lastPending = pendingRef.current;

    const schedule = (ms: number) => {
      if (!stopped) timer = setTimeout(poll, ms);
    };

    const finish = (path: string, replace = true) => {
      stopped = true;
      if (replace) router.replace(path);
      else router.push(path);
    };

    const failedPath = (reason: string | null) => {
      const trimmed = (reason || "").slice(0, 160);
      return `/admin/shop/sources?import=failed${
        trimmed ? `&reason=${encodeURIComponent(trimmed)}` : ""
      }`;
    };

    async function poll(): Promise<void> {
      if (stopped) return;
      polls += 1;
      try {
        const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
        const response = await fetch(`/api/admin/shop/import-jobs/status${query}`, {
          cache: "no-store",
        });
        if (response.status === 401) {
          stopped = true;
          router.refresh();
          return;
        }
        if (response.status === 404) {
          finish("/admin/shop/sources?import=missing_offer");
          return;
        }
        if (!response.ok) {
          if (polls < MAX_POLLS) schedule(4_000);
          else finish("/admin/shop/sources?import=timeout");
          return;
        }
        const data = (await response.json()) as { pending: number; job?: JobStatus };
        if (stopped) return;

        const job = data.job;
        if (job?.productId && (job.status === "draft_ready" || job.status === "skipped")) {
          finish(
            `/admin/shop/products/${job.productId}?${
              job.status === "draft_ready" ? "ai=1" : "existing=1"
            }`,
            false,
          );
          return;
        }
        if (job && (job.status === "failed" || job.status === "skipped")) {
          finish(failedPath(job.error));
          return;
        }
        if (job?.status === "draft_ready" && !job.productId) {
          finish(failedPath("草稿商品已被删除，请重新生成"));
          return;
        }

        if (data.pending !== lastPending) {
          lastPending = data.pending;
          router.refresh();
        }
        if (data.pending > 0 && polls < MAX_POLLS) {
          schedule(POLL_MS);
        } else if (polls >= MAX_POLLS) {
          finish("/admin/shop/sources?import=timeout");
        }
      } catch {
        if (polls < MAX_POLLS) schedule(4_000);
        else finish("/admin/shop/sources?import=timeout");
      }
    }

    schedule(1_200);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, jobId, router]);

  return null;
}
