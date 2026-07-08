"use client";

/**
 * MessageNavRail — 右侧消息导航条（对标 DeepSeek）
 *
 * 消息区域右侧竖向排列短横杠，每条代表一次 assistant 回复。
 * hover 时横杠放大 + 显示消息内容预览气泡，点击滚动到对应消息。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  /** 消息内容前 120 字（用于 hover 预览） */
  preview: string;
  /** 对应 DOM 元素的 data-nav-id 属性值 */
  domId: string;
}

export function MessageNavRail({ items }: { items: NavItem[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const scrollToItem = useCallback((domId: string) => {
    const el = document.querySelector(`[data-nav-id="${CSS.escape(domId)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="absolute right-1 top-4 bottom-4 z-10 flex w-5 flex-col items-center justify-start gap-0.5"
      data-testid="message-nav-rail"
    >
      {items.map((item, idx) => {
        const isHovered = hoverIdx === idx;
        return (
          <div
            key={item.id}
            className="group relative flex h-full max-h-[40px] min-h-[6px] flex-1 cursor-pointer items-center"
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            onClick={() => scrollToItem(item.domId)}
          >
            {/* 横杠：hover 时放大 + 变色 */}
            <div
              className={cn(
                "rounded-full transition-all duration-200",
                isHovered
                  ? "h-1 w-4 bg-[var(--kp-brand)]"
                  : "h-0.5 w-2.5 bg-[var(--kp-divider)] hover:bg-[var(--kp-brand-light)]",
              )}
            />
            {/* hover 预览气泡 */}
            {isHovered && (
              <div className="pointer-events-none absolute right-full mr-2 top-1/2 z-20 w-64 -translate-y-1/2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-3 text-xs leading-relaxed text-[var(--kp-text-2)] shadow-lg">
                <div className="line-clamp-4">{item.preview}</div>
                <div className="mt-1.5 text-[10px] text-[var(--kp-text-3)]">第 {idx + 1} 条回复</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
