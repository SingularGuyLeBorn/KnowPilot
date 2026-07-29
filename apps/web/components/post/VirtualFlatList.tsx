"use client";

import React, { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface VirtualFlatListProps<T> {
  items: T[];
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
  overscan?: number;
  emptyMessage?: string;
}

/** 固定行高虚拟列表（文章树等）；独立叶子，避免经 shared 拉 framer-motion */
export function VirtualFlatList<T>({
  items,
  rowHeight,
  renderItem,
  getKey,
  className,
  overscan = 8,
  emptyMessage = "暂无数据",
}: VirtualFlatListProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight || 320);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-1 items-center justify-center p-4 text-sm text-[var(--kp-text-3)]",
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  const totalHeight = items.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );

  return (
    <div
      ref={containerRef}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="relative w-full" style={{ height: totalHeight }}>
        {items.slice(startIndex, endIndex).map((item, i) => {
          const index = startIndex + i;
          return (
            <div
              key={getKey(item, index)}
              className="absolute left-0 right-0"
              style={{ top: index * rowHeight, height: rowHeight }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
