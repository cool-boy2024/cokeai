"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, X } from "@phosphor-icons/react";
import {
  announcementLevelLabel,
  type AnnouncementLevel,
} from "@/lib/announcement-types";

type Props = {
  items: Array<{
    id: string;
    title: string;
    body: string;
    level: AnnouncementLevel;
    updated_at: string;
  }>;
};

export function AnnouncementStrip({ items }: Props) {
  const latest = items[0];
  const storageKey = latest
    ? `cokeai:announcement:${latest.id}:${latest.updated_at}`
    : "";
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Storage can be disabled; keep the announcement visible.
    }
  }, [storageKey]);

  if (!latest || dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage failures.
    }
    setDismissed(true);
  };

  return (
    <div
      className={`announcement-bar announcement-${latest.level}`}
      role="region"
      aria-label="站点公告"
    >
      <div className="container announcement-inner">
        <span className="announcement-mark">
          <Megaphone size={14} weight="bold" />
          {announcementLevelLabel(latest.level)}
        </span>
        <p className="announcement-text">
          <strong>{latest.title}</strong>
          {latest.body ? <span>{latest.body}</span> : null}
        </p>
        <Link className="announcement-link" href="/announcements">
          全部公告
        </Link>
        <button
          type="button"
          className="announcement-close"
          aria-label="关闭公告"
          onClick={dismiss}
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
