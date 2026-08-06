"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  beginNavigation,
  endNavigation,
  subscribeNavigationProgress,
} from "@/lib/navigationProgress";
import { cn } from "@/lib/utils";

function sameDocumentUrl(href: string): URL | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    return url;
  } catch {
    return null;
  }
}

function isInternalNavAnchor(el: Element): el is HTMLAnchorElement {
  if (!(el instanceof HTMLAnchorElement)) return false;
  const href = el.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return false;
  }
  if (el.target === "_blank" || el.hasAttribute("download")) return false;
  return sameDocumentUrl(href) != null;
}

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const [barOn, setBarOn] = useState(false);
  const [labelOn, setLabelOn] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const barShownRef = useRef(false);
  const showBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLabelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeKeyRef = useRef(routeKey);

  const clearTimer = (ref: { current: ReturnType<typeof setTimeout> | null }) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  };

  useEffect(() => {
    const armUi = () => {
      clearTimer(hideTimer);
      setFinishing(false);
      clearTimer(showBarTimer);
      showBarTimer.current = setTimeout(() => {
        barShownRef.current = true;
        setBarOn(true);
      }, 90);
      clearTimer(showLabelTimer);
      showLabelTimer.current = setTimeout(() => setLabelOn(true), 260);
      clearTimer(safetyTimer);
      safetyTimer.current = setTimeout(() => {
        endNavigation();
      }, 10_000);
    };

    const disarmUi = () => {
      clearTimer(showBarTimer);
      clearTimer(showLabelTimer);
      clearTimer(safetyTimer);
      setLabelOn(false);

      if (!barShownRef.current) {
        setBarOn(false);
        setFinishing(false);
        return;
      }

      setFinishing(true);
      setBarOn(true);
      clearTimer(hideTimer);
      hideTimer.current = setTimeout(() => {
        barShownRef.current = false;
        setBarOn(false);
        setFinishing(false);
        setLabelOn(false);
      }, 320);
    };

    return subscribeNavigationProgress((active) => {
      if (active) armUi();
      else disarmUi();
    });
  }, []);

  useEffect(() => {
    if (routeKeyRef.current === routeKey) return;
    routeKeyRef.current = routeKey;
    endNavigation();
  }, [routeKey]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !isInternalNavAnchor(a)) return;
      const url = sameDocumentUrl(a.href);
      if (!url) return;
      const next = `${url.pathname}${url.search}`;
      const cur = `${window.location.pathname}${window.location.search}`;
      if (next === cur) return;
      beginNavigation();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const orig = window.history.pushState.bind(window.history);
    window.history.pushState = function (...args) {
      const url = args[2];
      if (typeof url === "string" || url instanceof URL) {
        const next = sameDocumentUrl(String(url));
        if (next) {
          const a = `${next.pathname}${next.search}`;
          const b = `${window.location.pathname}${window.location.search}`;
          if (a !== b) beginNavigation();
        }
      }
      return orig(...args);
    };
    return () => {
      window.history.pushState = orig;
    };
  }, []);

  useEffect(() => {
    return () => {
      clearTimer(showBarTimer);
      clearTimer(showLabelTimer);
      clearTimer(hideTimer);
      clearTimer(safetyTimer);
    };
  }, []);

  const show = barOn || finishing;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200]"
      aria-live="polite"
      aria-busy={show && !finishing}
      aria-hidden={!show}
    >
      <div
        className={cn(
          "h-[2.5px] w-full origin-left transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
      >
        <div
          className={cn(
            "h-full rounded-r-full bg-[var(--kp-brand)] shadow-[0_0_12px_color-mix(in_srgb,var(--kp-brand)_55%,transparent)]",
            finishing ? "kp-nav-progress-done" : show ? "kp-nav-progress-run" : "scale-x-0",
          )}
        />
      </div>

      <div
        className={cn(
          "absolute left-1/2 top-3 -translate-x-1/2 transition-all duration-300",
          labelOn && !finishing ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
        )}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3 py-1 text-[11px] font-semibold text-[var(--kp-text-2)] shadow-[0_8px_24px_-12px_rgba(0,80,160,0.35)] backdrop-blur-md dark:border-white/10 dark:bg-[var(--kp-bg-alt)]/90">
          <span
            aria-hidden
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--kp-brand)]"
          />
          跳转中
        </span>
      </div>
    </div>
  );
}

/** Suspense：useSearchParams 需要边界 */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
