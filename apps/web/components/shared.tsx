/**
 * KnowPilot 前端通用共享 UI 组件库 (Shared UI Components)
 *
 * 【扁平化单文件设计】：
 * 1. 包含 Pagination (分页组件)、EmptyState (空状态组件)。
 * 2. 包含 LoadingState (加载骨架屏)、ConfirmDialog (玻璃模态二次确认弹窗)。
 * 3. 包含 KpSelect (莫兰迪风格自定义下拉，替代原生 select)。
 * 4. 彻底删除 components/shared/ 子目录，消除一堆 index.ts 导出的冗余度。
 */

"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Globe,
  XCircle,
  LayoutGrid,
  List,
  Search,
  Telescope,
  Database,
  Shield,
  Cloud,
  Target,
  Radar,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCardDensity, type CardDensity } from "@/lib/hooks";
import { Button, buttonVariants } from "./ui/button";
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
                    ? "border border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)] hover:bg-[var(--kp-brand-soft)]"
                    : "border-[var(--kp-divider)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]"
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
   1b. EntityCard — 通用实体卡片（支持紧凑/舒适密度）
   ═══════════════════════════════════════════════════════ */

export function EntityCard({
  density: densityProp,
  className,
  children,
  ...props
}: React.ComponentProps<typeof motion.div> & { density?: CardDensity }) {
  const { density: densityFromHook } = useCardDensity();
  const density = densityProp ?? densityFromHook;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 transition hover:shadow-lg",
        density === "compact" ? "p-3" : "p-5",
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function CardDensityToggle({ className }: { className?: string }) {
  const { density, toggle } = useCardDensity();
  return (
    <button
      type="button"
      onClick={toggle}
      title={density === "compact" ? "切换为舒适视图" : "切换为紧凑视图"}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--kp-divider)] text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
        className,
      )}
    >
      {density === "compact" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
    </button>
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
    <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-[var(--kp-divider)] rounded-2xl bg-[var(--kp-bg-alt)] min-h-[300px]">
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--kp-bg-soft)] text-[var(--kp-text-3)] mb-4">
        {icon || <Inbox className="w-6 h-6" />}
      </div>
      <h3 className="text-base font-semibold text-[var(--kp-text-1)] mb-1">
        {title}
      </h3>
      <p className="text-sm text-[var(--kp-text-3)] max-w-sm mb-6">
        {description}
      </p>
      {onAction && actionLabel && (
        <Button
          onClick={onAction}
          className="flex items-center gap-2 border border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand)]/15 transition-all rounded-xl"
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isDestructive 
                  ? "bg-red-500/10 text-red-500" 
                  : "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
              }`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-[var(--kp-text-1)]">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--kp-text-3)]">
                  {description}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={onCancel}
                className="rounded-xl border-[var(--kp-divider)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]"
              >
                {cancelLabel}
              </Button>
              <Button
                data-testid="confirm-dialog-confirm"
                onClick={() => {
                  onConfirm();
                  onCancel();
                }}
                className={`rounded-xl text-white transition-all ${
                  isDestructive
                    ? "bg-red-500 hover:bg-red-600 focus:ring-red-500"
                    : "bg-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-dark)] focus:ring-[var(--kp-brand)]"
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
   5. KpSelect — 莫兰迪自定义下拉（替代原生 select）
   ═══════════════════════════════════════════════════════ */

export interface KpSelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface KpSelectProps<T extends string = string> {
  value: T;
  options: KpSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  variant?: "default" | "capsule";
  size?: "sm" | "md";
  className?: string;
  menuClassName?: string;
  placeholder?: string;
  "aria-label"?: string;
  /** 与控件同一行的左侧标签（capsule 场景） */
  label?: string;
}

export function KpSelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled,
  variant = "default",
  size = "md",
  className,
  menuClassName,
  placeholder = "请选择",
  "aria-label": ariaLabel,
  label,
}: KpSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((o) => o.value === value);

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    window.addEventListener("scroll", updateMenuPos, true);
    window.addEventListener("resize", updateMenuPos);
    return () => {
      window.removeEventListener("scroll", updateMenuPos, true);
      window.removeEventListener("resize", updateMenuPos);
    };
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const triggerClass = cn(
    "inline-flex items-center justify-between gap-2 border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 text-[var(--kp-text-1)] shadow-sm outline-none transition",
    "hover:border-[var(--kp-brand-light)] focus-visible:border-[var(--kp-brand)] focus-visible:ring-2 focus-visible:ring-[var(--kp-brand)]/20",
    "disabled:cursor-not-allowed disabled:opacity-45",
    variant === "capsule" ? "rounded-full" : "rounded-xl w-full",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
    className,
  );

  const control = (
    <div className={cn(label ? "flex items-center justify-between gap-3" : "relative")}>
      {label && (
        <span className="text-xs font-medium text-[var(--kp-text-2)]">{label}</span>
      )}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(triggerClass, label && "shrink-0")}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
    </div>
  );

  const menu =
    open &&
    typeof document !== "undefined" &&
    ReactDOM.createPortal(
      <AnimatePresence>
        <motion.div
          ref={menuRef}
          id={listId}
          role="listbox"
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            minWidth: Math.max(menuPos.width, variant === "capsule" ? 148 : menuPos.width),
            zIndex: 9999,
          }}
          className={cn(
            "overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-1 shadow-lg shadow-[rgba(45,42,38,0.08)] backdrop-blur-md",
            menuClassName,
          )}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                  active
                    ? "bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-dark)]"
                    : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-dark)]" />}
              </button>
            );
          })}
        </motion.div>
      </AnimatePresence>,
      document.body,
    );

  return (
    <>
      {control}
      {menu}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   6. VirtualFlatList — 固定行高虚拟滚动（L5-M06）
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

/* ═══════════════════════════════════════════════════════
   6. NativeCapabilitiesPanel — 搜索/OCR/浏览器/read_article 能力
   ═══════════════════════════════════════════════════════ */

export const READ_PLATFORM_LABELS: Record<string, string> = {
  zhihu: "知乎",
  wechat: "微信",
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  weibo: "微博",
  juejin: "掘金",
  csdn: "CSDN",
  cnblogs: "博客园",
  jianshu: "简书",
  infoq: "InfoQ",
  segmentfault: "SegmentFault",
  oschina: "开源中国",
  github: "GitHub",
  stackoverflow: "StackOverflow",
};

export interface NativeCapabilitiesData {
  search: { priority: string; engines: string[] };
  ocr: { modelsReady: boolean };
  browser: { chromeInstalled: boolean; poolReady: boolean };
  readArticle: {
    platforms: string[];
    cookies?: { zhihu: boolean; wechat: boolean; xhs: boolean; douyin: boolean };
  };
  infoSources?: { enabled: number };
}

function CapabilityStatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        ok ? "bg-emerald-500/10 text-emerald-700" : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

/* ─── 搜索引擎小药丸 ─── */

const ENGINE_STYLES: Record<
  string,
  {
    label: string;
    bg: string;
    text: string;
    border: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  bing_crawler: { label: "Bing Crawler", bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200", icon: Search },
  tavily: { label: "Tavily", bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200", icon: Telescope },
  serpapi: { label: "SerpAPI", bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", icon: Database },
  duckduckgo: { label: "DuckDuckGo", bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", icon: Shield },
  baidu_qianfan: { label: "百度千帆", bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", icon: Cloud },
  metaso: { label: "Metaso", bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200", icon: Target },
  bocha: { label: "Bocha", bg: "bg-rose-50", text: "text-rose-600", border: "border-rose-200", icon: Radar },
  langsearch: { label: "LangSearch", bg: "bg-cyan-50", text: "text-cyan-600", border: "border-cyan-200", icon: Languages },
  brave: { label: "Brave", bg: "bg-red-50", text: "text-red-600", border: "border-red-200", icon: Shield },
  bing: { label: "Bing", bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-200", icon: Search },
  searxng: { label: "SearXNG", bg: "bg-lime-50", text: "text-lime-700", border: "border-lime-200", icon: Globe },
};

function SearchEnginePill({ engine }: { engine: string }) {
  const style = ENGINE_STYLES[engine];
  const Icon = style?.icon ?? Search;
  const label = style?.label ?? engine;
  return (
    <span
      title={engine}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-80",
        style?.bg ?? "bg-[var(--kp-bg-mute)]",
        style?.text ?? "text-[var(--kp-text-2)]",
        style?.border ?? "border-[var(--kp-divider)]",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function NativeCapabilitiesPanel({
  data,
  compact = false,
  className,
  title = "原生运行时能力",
  detailHref,
  detailLabel = "Tools 能力详情",
  showSearchEnginesInCompact = false,
}: {
  data: NativeCapabilitiesData;
  compact?: boolean;
  className?: string;
  title?: string;
  detailHref?: string;
  detailLabel?: string;
  showSearchEnginesInCompact?: boolean;
}) {
  const cookieEntries = data.readArticle.cookies
    ? ([
        ["zhihu", "知乎 Cookie", data.readArticle.cookies.zhihu],
        ["wechat", "微信 Cookie", data.readArticle.cookies.wechat],
        ["xhs", "小红书 Cookie", data.readArticle.cookies.xhs],
        ["douyin", "抖音 Cookie", data.readArticle.cookies.douyin],
      ] as const)
    : [];

  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 space-y-3",
        compact ? "p-4" : "p-5 space-y-4",
        className,
      )}
      data-testid="native-capabilities-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
          <Globe className="h-4 w-4 text-[var(--kp-brand)]" />
          {title}
        </div>
        {detailHref && (
          <Link
            href={detailHref}
            className="text-[10px] font-medium text-[var(--kp-brand)] hover:underline"
          >
            {detailLabel} →
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <CapabilityStatusDot
          ok={data.search.engines.length > 0}
          label={`搜索 ${data.search.engines.length}`}
        />
        <CapabilityStatusDot ok={data.ocr.modelsReady} label="OCR" />
        <CapabilityStatusDot ok={data.browser.poolReady} label="Playwright" />
        <CapabilityStatusDot ok={data.browser.chromeInstalled} label="Chrome" />
        {data.infoSources !== undefined && (
          <CapabilityStatusDot
            ok={data.infoSources.enabled > 0}
            label={`信息源 ${data.infoSources.enabled}`}
          />
        )}
      </div>
      {(showSearchEnginesInCompact || !compact) && data.search.engines.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--kp-text-3)]">引擎：</span>
            {data.search.engines.map((engine) => (
              <SearchEnginePill key={engine} engine={engine} />
            ))}
            <span
              className="ml-1 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]/50 px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]"
              title="搜索优先级策略"
            >
              {data.search.priority}
            </span>
          </div>
        </div>
      )}
      {cookieEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cookieEntries.map(([key, label, ok]) => (
            <CapabilityStatusDot key={key} ok={ok} label={label} />
          ))}
        </div>
      )}
      {!compact && (
        <div>
          <p className="mb-2 text-[10px] font-medium text-[var(--kp-text-2)]">
            read_article · {data.readArticle.platforms.length} 平台
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.readArticle.platforms.map((p) => (
              <span
                key={p}
                className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[10px] text-[var(--kp-text-2)]"
              >
                {READ_PLATFORM_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   9. PageHeader — 管理页紧凑标题头（替代各页整屏渐变 Hero banner）
   统一 17+ 管理页视觉，少占一屏，h1 文案不变（E2E 断言 level=1 heading）
   ═══════════════════════════════════════════════════════ */

export interface PageHeaderAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
  children,
  showDensityToggle = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: PageHeaderAction;
  children?: React.ReactNode;
  showDensityToggle?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-[var(--kp-text-1)]">{title}</h1>
          {description && (
            <p className="mt-0.5 truncate text-xs text-[var(--kp-text-3)]" title={description}>
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        {showDensityToggle && <CardDensityToggle />}
        {action &&
          (action.href ? (
            <Link
              href={action.href}
              className={cn(buttonVariants(), "gap-1.5")}
            >
              {action.icon && <action.icon className="h-4 w-4" />}
              {action.label}
            </Link>
          ) : (
            <Button onClick={action.onClick} disabled={action.disabled} className="gap-1.5">
              {action.icon && <action.icon className="h-4 w-4" />}
              {action.label}
            </Button>
          ))}
      </div>
    </div>
  );
}
