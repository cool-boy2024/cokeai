"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "@phosphor-icons/react";
import {
  announcementLevelLabel,
  type AnnouncementLevel,
} from "@/lib/announcement-types";

type Props = {
  item: {
    id: string;
    title: string;
    body: string;
    level: AnnouncementLevel;
    updated_at: string;
  };
};

const SESSION_PREFIX = "cokeai:announcement-modal:session:";

/**
 * Store-wide welcome notice, shown once per announcement version. "我已阅读"
 * remembers the acknowledgement for this browser; "取消" only silences it for
 * the current session, so a visitor who skips the notice still sees it on the
 * next visit. Editing the announcement changes updated_at and shows it again.
 */
export function AnnouncementModal({ item }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  const storageKey = `cokeai:announcement-modal:${item.id}:${item.updated_at}`;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "1") return;
      if (window.sessionStorage.getItem(SESSION_PREFIX + storageKey) === "1") return;
    } catch {
      // Storage can be disabled; showing the notice is the safer default.
    }
    setOpen(true);
  }, [storageKey]);

  const close = useCallback(
    (remember: boolean) => {
      try {
        if (remember) window.localStorage.setItem(storageKey, "1");
        else window.sessionStorage.setItem(SESSION_PREFIX + storageKey, "1");
      } catch {
        // Ignore storage failures; the modal still closes for this page.
      }
      setOpen(false);
    },
    [storageKey],
  );

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    readRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="announcement-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(false);
      }}
    >
      <div
        ref={dialogRef}
        className={`announcement-modal announcement-modal-${item.level}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-modal-title"
      >
        <header className="announcement-modal-head">
          <span className="announcement-modal-eyebrow">
            Notice · {announcementLevelLabel(item.level)}
          </span>
          <button
            type="button"
            className="announcement-modal-close"
            aria-label="关闭公告"
            onClick={() => close(false)}
          >
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="announcement-modal-scroll">
          <h2 id="announcement-modal-title">{item.title}</h2>
          {item.body ? <p className="announcement-modal-body">{item.body}</p> : null}
          <Link
            className="announcement-modal-link"
            href="/announcements"
            onClick={() => close(false)}
          >
            查看全部公告
          </Link>
        </div>

        <footer className="announcement-modal-foot">
          <button type="button" className="btn btn-light" onClick={() => close(false)}>
            取消
          </button>
          <button
            ref={readRef}
            type="button"
            className="btn btn-primary"
            onClick={() => close(true)}
          >
            我已阅读
          </button>
        </footer>
      </div>
    </div>
  );
}
