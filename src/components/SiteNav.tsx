"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "@phosphor-icons/react";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/shop", label: "小店", index: "01" },
  { href: "/#models", label: "模型", index: "02" },
  { href: "/pricing", label: "价格", index: "03" },
  { href: "/docs", label: "教程", index: "04" },
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

  // Keep the floating bar on the first screen and out of the reading path.
  // It slides away when scrolling down, and returns on scroll up or when the
  // pointer reaches the top edge of the viewport.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(
      ".public-header.site-header",
    );
    if (!header) return;

    let lastY = window.scrollY;
    let hidden = false;
    let frame = 0;

    const setHidden = (next: boolean) => {
      if (hidden === next) return;
      hidden = next;
      header.classList.toggle("is-away", next);
    };

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      if (y < 96) setHidden(false);
      else if (y < lastY - 4) setHidden(false);
      else if (y > lastY + 4) setHidden(true);
      lastY = y;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.clientY <= 56) {
        setHidden(false);
      }
    };
    const onPointerLeave = () => {
      if (window.scrollY > 96) setHidden(true);
    };
    const onFocusIn = () => setHidden(false);

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    header.addEventListener("pointerleave", onPointerLeave);
    header.addEventListener("focusin", onFocusIn);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      header.removeEventListener("pointerleave", onPointerLeave);
      header.removeEventListener("focusin", onFocusIn);
      header.classList.remove("is-away");
    };
  }, []);

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
            <span>{link.index}</span>
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
        <p>OpenAI 兼容接口 · 余额不过期</p>
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
              开始使用
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
