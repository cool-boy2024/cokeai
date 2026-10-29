"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "@phosphor-icons/react";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/shop", label: "小店" },
  { href: "/#models", label: "模型" },
  { href: "/pricing", label: "价格" },
  { href: "/docs", label: "教程" },
];

function isActive(pathname: string, href: string) {
  if (href === "/shop") return pathname.startsWith("/shop");
  if (href === "/#models") return false;
  return pathname === href;
}

export function SiteNav({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.setTimeout(() => toggleRef.current?.focus(), 0);
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    window.setTimeout(() => toggleRef.current?.focus(), 0);
  };

  const panel = (
    <div
      ref={panelRef}
      id="public-mobile-menu"
      className={`public-mobile-menu${open ? " is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="站点导航"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="public-mobile-top">
        <Logo />
        <button
          ref={closeRef}
          type="button"
          className="public-mobile-close"
          aria-label="关闭菜单"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>

      <nav className="public-mobile-nav" aria-label="移动导航">
        {LINKS.map((link, index) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(pathname, link.href) ? "page" : undefined}
            style={{ "--menu-i": index } as CSSProperties}
            onClick={close}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="public-mobile-foot">
        {loggedIn ? (
          <Link className="btn btn-primary" href="/dashboard" onClick={close}>
            进入控制台
          </Link>
        ) : (
          <>
            <Link className="btn btn-primary" href="/register" onClick={close}>
              创建账号
            </Link>
            <Link className="btn btn-light" href="/login" onClick={close}>
              登录已有账户
            </Link>
          </>
        )}
        <p>兼容 OpenAI SDK · 余额不过期</p>
      </div>
    </div>
  );

  return (
    <>
      <nav className="public-nav" aria-label="主导航">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="public-nav-link"
            aria-current={isActive(pathname, link.href) ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="public-actions">
        {loggedIn ? (
          <Link className="btn btn-dark" href="/dashboard">
            控制台
          </Link>
        ) : (
          <>
            <Link className="public-login" href="/login">
              登录
            </Link>
            <Link className="btn btn-primary" href="/register">
              创建账号
            </Link>
          </>
        )}
      </div>

      <button
        ref={toggleRef}
        type="button"
        className={`public-menu-toggle${open ? " is-open" : ""}`}
        aria-label={open ? "关闭菜单" : "打开菜单"}
        aria-expanded={open}
        aria-controls="public-mobile-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
      </button>

      {mounted ? createPortal(panel, document.body) : null}
    </>
  );
}
