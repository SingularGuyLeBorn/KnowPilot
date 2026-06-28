/**
 * KnowPilot 前端通用共享 UI 组件库 (Shared UI Components)
 *
 * 【扁平化单文件设计】：
 * 1. 包含 Pagination (分页组件)、EmptyState (空状态组件)。
 * 2. 包含 LoadingState (加载骨架屏)、ConfirmDialog (玻璃模态二次确认弹窗)。
 * 3. 彻底删除 components/shared/ 子目录，消除一堆 index.ts 导出的冗余度。
 */

"use client";

import React, { useEffect, useState, useLayoutEffect } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Inbox, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

/* ═══════════════════════════════════════════════════════
   1. Pagination — 通用分页组件
   ═══════════════════════════════════════════════════════ */

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-2 py-4 border-t border-[var(--vp-c-divider-light)]">
      <div className="text-sm text-[var(--vp-c-text-3)]">
        共 <span className="font-medium text-[var(--vp-c-text-1)]">{total}</span> 条记录，
        每页 <span className="font-medium text-[var(--vp-c-text-1)]">{pageSize}</span> 条
      </div>
      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="h-8 w-8 rounded-lg border-[var(--vp-c-divider)] text-[var(--vp-c-text-2)] hover:text-[var(--vp-c-text-1)] hover:bg-[var(--vp-c-bg-soft)]"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex items-center space-x-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            if (totalPages > 6 && Math.abs(p - page) > 2 && p !== 1 && p !== totalPages) {
              if (p === 2 || p === totalPages - 1) {
                return (
                  <span key={p} className="px-2 text-[var(--vp-c-text-3)] text-xs">
                    ...
                  </span>
                );
              }
              return null;
            }

            return (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(p)}
                className={`h-8 w-8 rounded-lg text-xs ${
                  p === page
                    ? "bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)]"
                    : "border-[var(--vp-c-divider)] text-[var(--vp-c-text-2)] hover:bg-[var(--vp-c-bg-soft)]"
                }`}
              >
                {p}
              </Button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="h-8 w-8 rounded-lg border-[var(--vp-c-divider)] text-[var(--vp-c-text-2)] hover:text-[var(--vp-c-text-1)] hover:bg-[var(--vp-c-bg-soft)]"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   2. EmptyState — 通用数据为空页面
   ═══════════════════════════════════════════════════════ */

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title = "暂无数据",
  description = "目前没有任何记录，请创建新数据开始。",
  icon,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-[var(--vp-c-divider)] rounded-2xl bg-[var(--vp-c-bg-alt)]/50 backdrop-blur-sm min-h-[300px]">
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--vp-c-bg-soft)] text-[var(--vp-c-text-3)] mb-4">
        {icon || <Inbox className="w-6 h-6" />}
      </div>
      <h3 className="text-base font-semibold text-[var(--vp-c-text-1)] mb-1">
        {title}
      </h3>
      <p className="text-sm text-[var(--vp-c-text-3)] max-w-sm mb-6">
        {description}
      </p>
      {onAction && actionLabel && (
        <Button
          onClick={onAction}
          className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] transition-all rounded-xl"
        >
          <Plus className="w-4 h-4" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   3. LoadingState — 通用加载骨架屏
   ═══════════════════════════════════════════════════════ */

interface LoadingStateProps {
  count?: number;
}

export function LoadingState({ count = 3 }: LoadingStateProps) {
  return (
    <div className="space-y-4 w-full">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="p-5 border border-[var(--vp-c-divider-light)] rounded-2xl bg-[var(--vp-c-bg-alt)]/30 space-y-3 animate-pulse"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-1/4 rounded-lg bg-[var(--vp-c-bg-mute)]" />
            <Skeleton className="h-4 w-12 rounded-lg bg-[var(--vp-c-bg-mute)]" />
          </div>
          <Skeleton className="h-4 w-2/3 rounded-lg bg-[var(--vp-c-bg-mute)]" />
          <div className="flex items-center space-x-2 pt-2">
            <Skeleton className="h-3 w-16 rounded-md bg-[var(--vp-c-bg-mute)]" />
            <Skeleton className="h-3 w-20 rounded-md bg-[var(--vp-c-bg-mute)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   4. ConfirmDialog — 二次确认对话框
   ═══════════════════════════════════════════════════════ */

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  isDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Portal 需在客户端挂载后渲染，避免 SSR 访问 document
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 标准 portal 挂载模式
    setMounted(true);
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!mounted) return null;

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ 
              scale: 1, 
              opacity: 1, 
              y: 0,
              transition: { type: "spring", stiffness: 300, damping: 25 }
            }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg)] p-6 shadow-2xl z-10"
          >
            <div className="flex items-start gap-4">
              <div className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${
                isDestructive 
                  ? "bg-red-500/10 text-red-500" 
                  : "bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]"
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-[var(--vp-c-text-1)]">
                  {title}
                </h3>
                <p className="text-sm text-[var(--vp-c-text-3)] leading-relaxed">
                  {description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={onCancel}
                className="rounded-xl border-[var(--vp-c-divider)] text-[var(--vp-c-text-2)] hover:bg-[var(--vp-c-bg-soft)]"
              >
                {cancelLabel}
              </Button>
              <Button
                onClick={() => {
                  onConfirm();
                  onCancel();
                }}
                className={`rounded-xl text-white transition-all ${
                  isDestructive
                    ? "bg-red-500 hover:bg-red-600 focus:ring-red-500"
                    : "bg-[var(--vp-c-brand)] hover:bg-[var(--vp-c-brand-dark)]"
                }`}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════════
   5. VirtualFlatList — 固定行高虚拟滚动（L5-M06）
   ═══════════════════════════════════════════════════════ */

export interface VirtualFlatListProps<T> {
  items: T[];
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
  overscan?: number;
  emptyMessage?: string;
}

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
      <div className={cn("flex flex-1 items-center justify-center p-4 text-sm text-[var(--vp-c-text-3)]", className)}>
        {emptyMessage}
      </div>
    );
  }

  const totalHeight = items.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);

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
