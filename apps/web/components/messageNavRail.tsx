"use client";

/**
 * MessageNavRail — 右侧消息导航条（对标 DeepSeek）
 *
 * 横杠默认聚在竖直中线，条数增多时向两侧延展；当前可视回复用更深色标出。
 */

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  /** 消息内容前 120 字（用于 hover 预览） */
  preview: string;
  /** 对应 DOM 元素的 data-nav-id 属性值 */
  domId: string;
  /** 在消息列表中的索引（用于虚拟列表滚动定位） */
  index: number;
}

export const MessageNavRail = memo(function MessageNavRail({
  items,
  activeIndex,
  onScrollToIndex,
}: {
  items: NavItem[];
  /** 当前视口对应的 nav 下标；未传则默认最后一条 */
  activeIndex?: number | null;
  /** 虚拟列表模式下按索引滚动；未提供则回退到 DOM scrollIntoView */
  onScrollToIndex?: (index: number) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement | null>(null);

  const resolvedActive =
    activeIndex != null && activeIndex >= 0 && activeIndex < items.length
      ? activeIndex
      : items.length > 0
        ? items.length - 1
        : -1;

  const scrollToItem = useCallback(
    (item: NavItem) => {
      if (onScrollToIndex) {
        onScrollToIndex(item.index);
        return;
      }
      const el = document.querySelector(`[data-nav-id="${CSS.escape(item.domId)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [onScrollToIndex],
  );

  // 当前项变化时，若栈过高则把当前横杠滚进可视区（不打乱居中布局）
  useEffect(() => {
    activeBtnRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [resolvedActive]);

  if (items.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="pointer-events-none absolute right-3 top-4 bottom-4 z-10 flex w-6 flex-col items-center justify-center"
      data-testid="message-nav-rail"
    >
      {/* 居中堆叠：少时聚中，多了向上下延展；过高时可滚 */}
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
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={() => scrollToItem(item)}
              aria-label={`第 ${idx + 1} 条回复`}
              aria-current={isActive ? "true" : undefined}
            >
              <span
                className={cn(
                  "rounded-full transition-all duration-200",
                  isActive
                    ? "h-1.5 w-4 bg-[var(--kp-text-1)]"
                    : isHovered
                      ? "h-1 w-3.5 bg-[var(--kp-brand-deep)]"
                      : "h-[3px] w-2.5 bg-[var(--kp-text-3)]/55 hover:bg-[var(--kp-text-2)]",
                )}
              />
              {isHovered && (
                <div className="pointer-events-none absolute right-full top-1/2 z-20 mr-2 w-64 -translate-y-1/2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-3 text-left text-xs leading-relaxed text-[var(--kp-text-2)] shadow-lg">
                  <div className="line-clamp-4">{item.preview}</div>
                  <div className="mt-1.5 text-[10px] text-[var(--kp-text-3)]">
                    第 {idx + 1} 条回复{isActive ? " · 当前" : ""}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
