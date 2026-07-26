"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const OPEN_DELAY_MS = 280;
const CLOSE_DELAY_MS = 120;
const CARD_WIDTH = 272;

interface PostLinkPreviewProps {
  href: string;
  slug: string;
  garden?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}

interface CardPos {
  top: number;
  left: number;
  placeAbove: boolean;
}

export function PostLinkPreview({
  href,
  slug,
  garden = DEFAULT_POST_GARDEN,
  children,
  className,
  title,
}: PostLinkPreviewProps) {
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CardPos | null>(null);
  const labelId = useId();

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const { data, isFetching, isError } = trpc.post.preview.useQuery(
    { slug, garden },
    { enabled: open, staleTime: 60_000 },
  );

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const estimatedH = 148;
    const placeAbove =
      rect.bottom + gap + estimatedH > window.innerHeight && rect.top > estimatedH + gap;
    let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - CARD_WIDTH - 8));
    setPos({
      top: placeAbove ? rect.top - gap : rect.bottom + gap,
      left,
      placeAbove,
    });
  }, []);

  const scheduleOpen = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) {
      updatePos();
      return;
    }
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      updatePos();
      setOpen(true);
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePos]);

  const cardStyle: CSSProperties | undefined = pos
    ? {
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: CARD_WIDTH,
        transform: pos.placeAbove ? "translateY(-100%)" : undefined,
      }
    : undefined;

  return (
    <>
      <Link
        ref={triggerRef}
        href={href}
        className={className}
        title={title}
        aria-describedby={open ? labelId : undefined}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
      >
        {children}
      </Link>
      {typeof document !== "undefined" &&
        open &&
        pos &&
        createPortal(
          <div
            id={labelId}
            role="tooltip"
            className={cn(
              "z-[80] overflow-hidden rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-lg",
              "animate-in fade-in-0 zoom-in-95 duration-150",
            )}
            style={cardStyle}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
          >
            <div className="border-b border-[var(--kp-divider-light)] px-3 py-2">
              <p className="truncate text-[13px] font-semibold leading-snug text-[var(--kp-text-1)]">
                {data?.title ?? (isFetching ? "加载中…" : title ?? slug)}
              </p>
              {data?.category ? (
                <p className="mt-0.5 truncate text-[11px] text-[var(--kp-text-3)]">{data.category}</p>
              ) : null}
            </div>
            <div className="px-3 py-2">
              {isError ? (
                <p className="text-[12px] text-[var(--kp-text-3)]">预览加载失败</p>
              ) : (
                <p className="line-clamp-4 text-[12px] leading-relaxed text-[var(--kp-text-2)]">
                  {data?.previewText || (isFetching ? "…" : "暂无摘要")}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
