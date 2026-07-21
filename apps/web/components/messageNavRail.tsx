"use client";

/**
 * MessageNavRail — 右侧消息导航条（对标 DeepSeek）
 *
 * 横杠默认聚在竖直中线；锚点是用户发送的消息（大纲式跳转）。
 * hover 用 fixed 浮层预览（避免 overflow 裁切）；当前可视/点击项用更深色标出。
 */

import { memo, useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  /** 消息内容前 120 字（用于 hover 预览） */
  preview: string;
  /** 对应 DOM 元素的 data-nav-id 属性值 */
  domId: string;
  /** 在 Virtuoso data 中的索引（用于 scrollToIndex） */
  index: number;
  /** 版本角标，如 "2/2"；无多版本时省略 */
  versionLabel?: string;
}

export const MessageNavRail = memo(function MessageNavRail({
  items,
  activeIndex,
  onNavigate,
}: {
  items: NavItem[];
  /** 当前视口对应的 nav 下标；未传则默认最后一条 */
  activeIndex?: number | null;
  /** 点击导航：传入 nav 下标与 item（由列表侧负责精确滚动） */
  onNavigate?: (navIdx: number, item: NavItem) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [previewPos, setPreviewPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const activeBtnRef = useRef<HTMLButtonElement | null>(null);
  const hoverBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolvedActive =
    activeIndex != null && activeIndex >= 0 && activeIndex < items.length
      ? activeIndex
      : items.length > 0
        ? items.length - 1
        : -1;

  const updatePreviewPos = useCallback((btn: HTMLButtonElement | null) => {
    if (!btn) {
      setPreviewPos(null);
      return;
    }
    const rect = btn.getBoundingClientRect();
    setPreviewPos({
      top: rect.top + rect.height / 2,
      right: window.innerWidth - rect.left + 8,
    });
  }, []);

  const handleEnter = useCallback(
    (idx: number, btn: HTMLButtonElement | null) => {
      setHoverIdx(idx);
      hoverBtnRef.current = btn;
      updatePreviewPos(btn);
    },
    [updatePreviewPos],
  );

  const handleLeave = useCallback(() => {
    setHoverIdx(null);
    hoverBtnRef.current = null;
    setPreviewPos(null);
  }, []);

  // 窗口滚动/缩放时同步预览锚点（Virtuoso 内滚动不关预览位置）
  useLayoutEffect(() => {
    if (hoverIdx == null) return;
    const sync = () => updatePreviewPos(hoverBtnRef.current);
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [hoverIdx, updatePreviewPos]);

  // 当前项变化时，若栈过高则把当前横杠滚进可视区
  useEffect(() => {
    activeBtnRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [resolvedActive]);

  if (items.length === 0) return null;

  const hoverItem = hoverIdx != null ? items[hoverIdx] : null;

  return (
    <div
      className="pointer-events-none absolute right-3 top-4 bottom-4 z-20 flex w-6 flex-col items-center justify-center"
      data-testid="message-nav-rail"
    >
      {/* 横杠列可滚；预览走 portal，不被 overflow 裁切 */}
      <div className="pointer-events-auto flex max-h-full flex-col items-center justify-center gap-1.5 overflow-y-auto overscroll-contain py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, idx) => {
          const isHovered = hoverIdx === idx;
          const isActive = idx === resolvedActive;
          return (
            <button
              key={item.id}
              type="button"
              ref={isActive ? activeBtnRef : undefined}
              className="group relative flex h-3 w-6 shrink-0 cursor-pointer items-center justify-center"
              onMouseEnter={(e) => handleEnter(idx, e.currentTarget)}
              onMouseLeave={handleLeave}
              onFocus={(e) => handleEnter(idx, e.currentTarget)}
              onBlur={handleLeave}
              onClick={() => onNavigate?.(idx, item)}
              aria-label={`第 ${idx + 1} 条消息`}
              aria-current={isActive ? "true" : undefined}
              data-testid={`message-nav-tick-${idx}`}
            >
              <span
                className={cn(
                  "rounded-full transition-all duration-200",
                  isActive
                    ? "h-1.5 w-4 bg-[var(--kp-brand-deep)]"
                    : isHovered
                      ? "h-1 w-3.5 bg-[var(--kp-text-1)]"
                      : "h-[3px] w-2.5 bg-[var(--kp-text-3)]/55 group-hover:bg-[var(--kp-text-2)]",
                )}
              />
            </button>
          );
        })}
      </div>

      {mounted &&
        hoverItem &&
        previewPos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[80] w-64 -translate-y-1/2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-3 text-left text-xs leading-relaxed text-[var(--kp-text-2)] shadow-lg"
            style={{ top: previewPos.top, right: previewPos.right }}
            data-testid="message-nav-preview"
          >
            <div
              className={cn(
                "line-clamp-4",
                hoverIdx === resolvedActive ? "text-[var(--kp-brand-deep)]" : "text-[var(--kp-text-2)]",
              )}
            >
              {hoverItem.preview}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--kp-text-3)]">
              <span>
                第 {(hoverIdx ?? 0) + 1} 条消息
                {hoverIdx === resolvedActive ? " · 当前" : ""}
              </span>
              {hoverItem.versionLabel && (
                <span className="rounded-full bg-[var(--kp-brand-soft)] px-1.5 py-px text-[var(--kp-brand-deep)]">
                  {hoverItem.versionLabel}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});
