/**
 * 知识 Inbox — 平台 Tab + 收藏夹分页筛选；列表/卡片可切换
 */

"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  Inbox,
  Sparkles,
  Trash2,
  Heart,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LayoutGrid,
  List,
  CalendarClock,
  Link2,
  BookMarked,
  X,
  Check,
  CheckSquare,
  Square,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InboxItem } from "@knowpilot/shared";
import { useInbox } from "@/lib/hooks";
import {
  EmptyState,
  LoadingState,
  ConfirmDialog,
  Pagination,
  AdminPage,
  KpSelect,
} from "@/components/shared";
import { cn } from "@/lib/utils";
import { catchUnlessCancelled, trpc } from "@/lib/trpc";

const VIEW_MODE_KEY = "kp-inbox-view-mode";
const COLLECTION_PAGE_SIZE = 8;

const SOURCE_LABELS: Record<string, string> = {
  screenshot: "截图",
  zhihu: "知乎",
  xhs: "小红书",
  bilibili: "B站",
  wechat: "微信",
  url: "链接",
};

const STATUS_LABELS: Record<string, string> = {
  fetched: "待消化",
  distilled: "已成文",
  ignored: "已忽略",
};

const PLATFORMS = ["zhihu", "xhs", "bilibili", "wechat", "screenshot", "url"] as const;

type ViewMode = "card" | "list";
const DEFAULT_VIEW_MODE: ViewMode = "list";

const viewModeListeners = new Set<() => void>();
function subscribeViewMode(cb: () => void) {
  viewModeListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === VIEW_MODE_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    viewModeListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function getViewModeSnapshot(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === "card" || saved === "list") return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_VIEW_MODE;
}
function getViewModeServerSnapshot(): ViewMode {
  return DEFAULT_VIEW_MODE;
}
function persistViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  viewModeListeners.forEach((l) => l());
}

type BrowseKey =
  | { type: "all" }
  | { type: "source"; source: string }
  | { type: "zhihuCollection"; collectionId: string }
  | { type: "xhsTag"; tag: "like" | "favorite" }
  | { type: "bilibiliTag"; tag: "favorite" | "toview" }
  | { type: "bilibiliCollection"; collectionId: string };

function browseEquals(a: BrowseKey, b: BrowseKey): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "all" && b.type === "all") return true;
  if (a.type === "source" && b.type === "source") return a.source === b.source;
  if (a.type === "zhihuCollection" && b.type === "zhihuCollection") {
    return a.collectionId === b.collectionId;
  }
  if (a.type === "xhsTag" && b.type === "xhsTag") return a.tag === b.tag;
  if (a.type === "bilibiliTag" && b.type === "bilibiliTag") return a.tag === b.tag;
  if (a.type === "bilibiliCollection" && b.type === "bilibiliCollection") {
    return a.collectionId === b.collectionId;
  }
  return false;
}

function browsePlatform(browse: BrowseKey): string | null {
  if (browse.type === "source") return browse.source;
  if (browse.type === "zhihuCollection") return "zhihu";
  if (browse.type === "xhsTag") return "xhs";
  if (browse.type === "bilibiliTag" || browse.type === "bilibiliCollection") return "bilibili";
  return null;
}

function itemCollectionTitle(item: InboxItem): string | null {
  const t = item.metadata?.collectionTitle;
  return typeof t === "string" && t.trim() ? t : null;
}

const NOISE_TAGS = new Set([
  "zhihu",
  "xhs",
  "bilibili",
  "wechat",
  "screenshot",
  "url",
  "collection",
  "openapi",
  "like",
  "favorite",
  "fav",
  "toview",
  "liked",
  "collect",
]);

/** 列表/卡片共用的元状态 */
function itemMeta(item: InboxItem) {
  const collection = itemCollectionTitle(item);
  const author =
    typeof item.metadata?.author === "string" && item.metadata.author.trim()
      ? item.metadata.author.trim()
      : null;
  const contentType =
    typeof item.metadata?.contentType === "string" && item.metadata.contentType.trim()
      ? String(item.metadata.contentType)
      : null;
  const kindHint =
    item.source === "xhs" && item.tags?.includes("like")
      ? "点赞"
      : item.source === "xhs" && item.tags?.includes("favorite")
        ? "收藏"
        : item.source === "bilibili" && item.tags?.includes("toview")
          ? "稍后再看"
          : item.source === "bilibili" && (item.tags?.includes("fav") || item.tags?.includes("favorite"))
            ? "收藏"
            : null;
  const tags = (item.tags ?? []).filter((t) => !NOISE_TAGS.has(t)).slice(0, 4);
  const sourceAt =
    item.sourceAt != null
      ? new Date(item.sourceAt)
      : typeof item.metadata?.publishedAt === "number"
        ? new Date(item.metadata.publishedAt)
        : null;
  const isSourceTime = Boolean(sourceAt && !Number.isNaN(sourceAt.getTime()));
  const rawTime = (isSourceTime ? sourceAt! : new Date(item.capturedAt)).toLocaleString();
  // 小红书列表同步常无原帖时间：回退到收录时间时必须明示，避免「按原帖时间」下全员同一时刻被误认成发帖时间
  const timeLabel = isSourceTime ? `原帖 ${rawTime}` : `收录 ${rawTime}`;
  return {
    sourceLabel: SOURCE_LABELS[item.source] || item.source,
    statusLabel: STATUS_LABELS[item.status] || item.status,
    collection,
    author,
    contentType,
    kindHint,
    tags,
    hasUrl: Boolean(item.url),
    hasBody: Boolean(item.content?.trim() || item.contentPath || item.excerpt?.trim()),
    distilled: Boolean(item.distilledPostId),
    timeLabel,
    isSourceTime,
  };
}

function MetaPill({
  children,
  tone = "mute",
}: {
  children: ReactNode;
  tone?: "mute" | "warn" | "ok" | "brand";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] leading-none",
        tone === "mute" && "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
        tone === "warn" && "bg-amber-500/12 text-amber-800 dark:text-amber-300",
        tone === "ok" && "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
        tone === "brand" && "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
      )}
    >
      {children}
    </span>
  );
}

function InboxItemActions({
  item,
  onDelete,
}: {
  item: InboxItem;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 transition-opacity duration-150",
        // 默认隐藏；卡片/行 hover 或焦点进入时再显示
        "pointer-events-none opacity-0",
        "group-hover:pointer-events-auto group-hover:opacity-100",
        "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      )}
    >
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand-deep)]"
          title="打开原文"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-red-600"
        title="删除"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

type FacetChip = {
  id: string;
  label: string;
  count: number;
  browse: BrowseKey;
  icon?: "heart" | "book" | "tv";
};

export default function InboxPage() {
  const {
    useList,
    useDelete,
    useStats,
    useFacets,
    useDistill,
    useIgnore,
    useCaptureUrl,
    useBulkDelete,
  } = useInbox();

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [browse, setBrowse] = useState<BrowseKey>({ type: "all" });
  const [statusFilter, setStatusFilter] = useState("fetched");
  const [orderBy, setOrderBy] = useState<"capturedAt" | "sourceAt">("sourceAt");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 默认单选；开启多选后可勾多条再批量操作 */
  const [multiSelect, setMultiSelect] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** 收藏夹芯片分页（与主列表 page 独立） */
  const [facetPage, setFacetPage] = useState(0);
  // SSR 固定 list；客户端挂载后再读 localStorage，避免 aria-pressed hydration 不一致
  const viewMode = useSyncExternalStore(
    subscribeViewMode,
    getViewModeSnapshot,
    getViewModeServerSnapshot,
  );
  const setViewModePersist = (mode: ViewMode) => {
    persistViewMode(mode);
  };

  const listInput = useMemo(() => {
    const base = {
      page,
      pageSize: 24,
      keyword: keyword || undefined,
      status: (statusFilter || undefined) as InboxItem["status"] | undefined,
      orderBy,
      order: "desc" as const,
    };
    if (browse.type === "source") {
      return { ...base, source: browse.source as InboxItem["source"] };
    }
    if (browse.type === "zhihuCollection") {
      return { ...base, source: "zhihu" as const, collectionId: browse.collectionId };
    }
    if (browse.type === "xhsTag") {
      return { ...base, source: "xhs" as const, tag: browse.tag };
    }
    if (browse.type === "bilibiliTag") {
      return { ...base, source: "bilibili" as const, tag: browse.tag };
    }
    if (browse.type === "bilibiliCollection") {
      return { ...base, source: "bilibili" as const, collectionId: browse.collectionId };
    }
    return base;
  }, [page, keyword, statusFilter, browse, orderBy]);

  const { data, isLoading, refetch } = useList(listInput);
  const { data: stats, refetch: refetchStats } = useStats();
  const { data: facets, refetch: refetchFacets } = useFacets(
    statusFilter === "fetched" || statusFilter === "distilled" || statusFilter === "ignored"
      ? { status: statusFilter }
      : {},
  );
  const deleteMutation = useDelete();
  const bulkDeleteMutation = useBulkDelete();
  const distillMutation = useDistill();
  const ignoreMutation = useIgnore();
  const captureMutation = useCaptureUrl();
  const utils = trpc.useUtils();

  const items = data?.items ?? [];
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const activePlatform = browsePlatform(browse);

  const facetChips: FacetChip[] = useMemo(() => {
    if (activePlatform === "zhihu") {
      return (facets?.zhihuCollections ?? []).map((col) => ({
        id: col.id,
        label: col.title,
        count: col.count,
        browse: { type: "zhihuCollection", collectionId: col.id } as BrowseKey,
        icon: "book" as const,
      }));
    }
    if (activePlatform === "xhs") {
      const chips: FacetChip[] = [];
      if ((facets?.xhs?.like ?? 0) > 0) {
        chips.push({
          id: "xhs-like",
          label: "点赞",
          count: facets!.xhs!.like,
          browse: { type: "xhsTag", tag: "like" },
          icon: "heart",
        });
      }
      if ((facets?.xhs?.favorite ?? 0) > 0) {
        chips.push({
          id: "xhs-fav",
          label: "收藏",
          count: facets!.xhs!.favorite,
          browse: { type: "xhsTag", tag: "favorite" },
          icon: "book",
        });
      }
      return chips;
    }
    if (activePlatform === "bilibili") {
      const chips: FacetChip[] = [];
      if ((facets?.bilibili?.favorite ?? 0) > 0) {
        chips.push({
          id: "bili-fav",
          label: "收藏",
          count: facets!.bilibili!.favorite,
          browse: { type: "bilibiliTag", tag: "favorite" },
          icon: "book",
        });
      }
      if ((facets?.bilibili?.toview ?? 0) > 0) {
        chips.push({
          id: "bili-toview",
          label: "稍后再看",
          count: facets!.bilibili!.toview,
          browse: { type: "bilibiliTag", tag: "toview" },
          icon: "tv",
        });
      }
      for (const col of facets?.bilibiliCollections ?? []) {
        chips.push({
          id: col.id,
          label: col.title,
          count: col.count,
          browse: { type: "bilibiliCollection", collectionId: col.id },
          icon: "tv",
        });
      }
      return chips;
    }
    return [];
  }, [activePlatform, facets]);

  const facetTotalPages = Math.max(1, Math.ceil(facetChips.length / COLLECTION_PAGE_SIZE));
  const safeFacetPage = Math.min(facetPage, facetTotalPages - 1);
  const pagedFacets = facetChips.slice(
    safeFacetPage * COLLECTION_PAGE_SIZE,
    safeFacetPage * COLLECTION_PAGE_SIZE + COLLECTION_PAGE_SIZE,
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4200);
  };

  const refreshAll = () => {
    const w = catchUnlessCancelled("inbox.refresh");
    refetch().catch(w);
    refetchStats().catch(w);
    refetchFacets().catch(w);
    utils.inbox.list.invalidate().catch(w);
  };

  const setBrowseAndReset = (next: BrowseKey) => {
    setBrowse(next);
    setPage(1);
    setSelected(new Set());
    // 换筛选时清搜索，避免 facet 计数与列表（带 keyword）分叉成「有计数却 0 条」
    setKeyword("");
    setSearchInput("");
    const nextPlat = browsePlatform(next);
    if (nextPlat !== activePlatform) setFacetPage(0);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (!multiSelect) {
        // 单选：点已选项取消，否则只保留当前
        if (prev.has(id) && prev.size === 1) return new Set();
        return new Set([id]);
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setMultiSelectMode = (on: boolean) => {
    setMultiSelect(on);
    if (!on) {
      // 退出多选时收成至多 1 条
      setSelected((prev) => {
        if (prev.size <= 1) return prev;
        const first = prev.values().next().value as string | undefined;
        return first ? new Set([first]) : new Set();
      });
    }
  };

  const selectAllOnPage = () => {
    setMultiSelect(true);
    setSelected(new Set(items.map((it: InboxItem) => it.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      showToast(`${label}完成`);
      setSelected(new Set());
      refreshAll();
    } catch (err) {
      showToast(`${label}失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const breadcrumb = useMemo(() => {
    if (browse.type === "all") return "全部素材";
    if (browse.type === "source") return SOURCE_LABELS[browse.source] || browse.source;
    if (browse.type === "xhsTag") return browse.tag === "like" ? "小红书 · 点赞" : "小红书 · 收藏";
    if (browse.type === "bilibiliTag") {
      return browse.tag === "toview" ? "B站 · 稍后再看" : "B站 · 收藏";
    }
    if (browse.type === "bilibiliCollection") {
      const col = facets?.bilibiliCollections?.find((c) => c.id === browse.collectionId);
      return col ? `B站 · ${col.title}` : "B站 · 收藏夹";
    }
    const col = facets?.zhihuCollections?.find((c) => c.id === browse.collectionId);
    return col ? `知乎 · ${col.title}` : "知乎 · 收藏夹";
  }, [browse, facets]);

  const platformSourceActive =
    browse.type === "source" || browse.type === "all"
      ? browse.type === "source"
        ? browse.source
        : null
      : activePlatform;

  return (
    <AdminPage className="!max-w-[1200px]">
      <header className="space-y-4 border-b border-[var(--kp-border)] pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--kp-text-3)]">
              <Inbox className="h-4 w-4" />
              <span className="text-[11px] font-semibold tracking-[0.14em] uppercase">Inbox</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--kp-text-1)]">
              知识收件箱
            </h1>
            <p className="mt-1 text-sm text-[var(--kp-text-2)]">
              选平台 → 可选收藏夹 → 勾选蒸馏。定时拉取在「平台每日同步」。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 hidden text-xs text-[var(--kp-text-3)] sm:inline">
              待消化{" "}
              <strong className="font-semibold text-[var(--kp-text-1)]">{stats?.fetched ?? 0}</strong>
              <span className="mx-1.5 text-[var(--kp-border)]">·</span>
              总计{" "}
              <strong className="font-semibold text-[var(--kp-text-1)]">{stats?.total ?? 0}</strong>
            </span>
            <Link
              href="/platform-sync"
              className="inline-flex h-8 items-center rounded-md border border-[var(--kp-border)] bg-[var(--kp-surface)] px-3 text-sm hover:bg-[var(--kp-bg-mute)]"
            >
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              每日同步
            </Link>
            <Button
              size="sm"
              disabled={!selectedIds.length || !!busy}
              onClick={() =>
                runAction("蒸馏", () => distillMutation.mutateAsync({ ids: selectedIds }))
              }
            >
              {busy === "蒸馏" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              蒸馏{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            className="sm:max-w-md"
            placeholder="粘贴单篇链接快速收录…"
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pasteUrl.trim()) {
                runAction("收录链接", async () => {
                  await captureMutation.mutateAsync({ url: pasteUrl.trim() });
                  setPasteUrl("");
                }).catch(catchUnlessCancelled("inbox.capture"));
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || !pasteUrl.trim()}
            onClick={() =>
              runAction("收录链接", async () => {
                await captureMutation.mutateAsync({ url: pasteUrl.trim() });
                setPasteUrl("");
              })
            }
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            收录
          </Button>
        </div>
      </header>

      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-lg border border-[var(--kp-border)] bg-[var(--kp-surface)] px-3 py-2 text-sm text-[var(--kp-text-2)]"
          >
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* 平台 Tab：点一下选中，再点「全部」离开 */}
      <section className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setBrowseAndReset({ type: "all" })}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition",
              browse.type === "all"
                ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-deep)]"
                : "border-[var(--kp-border)] bg-[var(--kp-surface)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
            )}
          >
            <Inbox className="h-3.5 w-3.5 opacity-70" />
            全部
            <span className="tabular-nums text-[11px] opacity-70">
              {facets?.total ?? stats?.total ?? 0}
            </span>
          </button>
          {PLATFORMS.map((src) => {
            const active = platformSourceActive === src;
            return (
              <button
                key={src}
                type="button"
                onClick={() => setBrowseAndReset({ type: "source", source: src })}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition",
                  active
                    ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-deep)]"
                    : "border-[var(--kp-border)] bg-[var(--kp-surface)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
                )}
              >
                {SOURCE_LABELS[src]}
                <span className="tabular-nums text-[11px] opacity-70">
                  {facets?.bySource?.[src] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* 子筛选：仅当前平台有收藏夹/标签时出现；可分页；可回「该平台全部」 */}
        {activePlatform && facetChips.length > 0 ? (
          <div className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--kp-text-3)]">
                {activePlatform === "zhihu"
                  ? "知乎收藏夹"
                  : activePlatform === "xhs"
                    ? "小红书分类"
                    : "B站分类"}
                <span className="ml-1.5 tabular-nums">共 {facetChips.length}</span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-2 py-1 text-xs transition",
                    browse.type === "source"
                      ? "bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-deep)]"
                      : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
                  )}
                  onClick={() =>
                    setBrowseAndReset({ type: "source", source: activePlatform })
                  }
                >
                  看该平台全部
                </button>
                {facetTotalPages > 1 ? (
                  <>
                    <button
                      type="button"
                      disabled={safeFacetPage <= 0}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--kp-border)] disabled:opacity-30"
                      aria-label="上一页收藏夹"
                      onClick={() => setFacetPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[3.5rem] text-center text-[11px] tabular-nums text-[var(--kp-text-3)]">
                      {safeFacetPage + 1}/{facetTotalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safeFacetPage >= facetTotalPages - 1}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--kp-border)] disabled:opacity-30"
                      aria-label="下一页收藏夹"
                      onClick={() =>
                        setFacetPage((p) => Math.min(facetTotalPages - 1, p + 1))
                      }
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pagedFacets.map((chip) => {
                const on = browseEquals(browse, chip.browse);
                const Icon =
                  chip.icon === "heart" ? Heart : chip.icon === "tv" ? Tv : BookMarked;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    title={chip.label}
                    onClick={() => setBrowseAndReset(chip.browse)}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition",
                      on
                        ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-deep)]"
                        : "border-[var(--kp-border)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
                    )}
                  >
                    <Icon className="h-3 w-3 shrink-0 opacity-60" />
                    <span className="truncate">{chip.label}</span>
                    <span className="shrink-0 tabular-nums opacity-60">{chip.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-[var(--kp-text-1)]">{breadcrumb}</span>
          {data ? (
            <span className="ml-2 text-xs text-[var(--kp-text-3)]">{data.total} 条</span>
          ) : null}
        </div>
        <div className="flex max-w-[240px] items-center gap-1">
          <Input
            className="flex-1"
            placeholder="搜索标题/摘要/链接/标签…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setKeyword(searchInput.trim());
                setPage(1);
              }
            }}
          />
          {keyword || searchInput ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--kp-border)] text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              title="清除搜索"
              aria-label="清除搜索"
              onClick={() => {
                setSearchInput("");
                setKeyword("");
                setPage(1);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <KpSelect
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部状态" },
            ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <KpSelect
          value={orderBy}
          onChange={(v) => {
            setOrderBy(v as "capturedAt" | "sourceAt");
            setPage(1);
          }}
          options={[
            { value: "sourceAt", label: "按原帖时间" },
            { value: "capturedAt", label: "按收录时间" },
          ]}
        />
        <div
          className="inline-flex h-8 items-center rounded-lg border border-[var(--kp-border)] bg-[var(--kp-surface)] p-0.5"
          role="group"
          aria-label="视图切换"
        >
          <button
            type="button"
            title="列表"
            aria-pressed={viewMode === "list"}
            onClick={() => setViewModePersist("list")}
            className={cn(
              "inline-flex h-7 w-8 items-center justify-center rounded-md transition",
              viewMode === "list"
                ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]",
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="卡片"
            aria-pressed={viewMode === "card"}
            onClick={() => setViewModePersist("card")}
            className={cn(
              "inline-flex h-7 w-8 items-center justify-center rounded-md transition",
              viewMode === "card"
                ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          title={multiSelect ? "当前：多选" : "当前：单选（点此项开启多选）"}
          aria-pressed={multiSelect}
          onClick={() => setMultiSelectMode(!multiSelect)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition",
            multiSelect
              ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
              : "border-[var(--kp-border)] bg-[var(--kp-surface)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
          )}
        >
          {multiSelect ? (
            <CheckSquare className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
          {multiSelect ? "多选" : "单选"}
        </button>
        {multiSelect ? (
          <>
            <Button size="sm" variant="outline" disabled={!items.length || !!busy} onClick={selectAllOnPage}>
              本页全选
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedIds.length || !!busy}
              onClick={clearSelection}
            >
              清空
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedIds.length || !!busy}
          onClick={() => runAction("忽略", () => ignoreMutation.mutateAsync({ ids: selectedIds }))}
        >
          忽略{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedIds.length || !!busy}
          className="text-red-600 hover:text-red-700"
          onClick={() => setPendingDeleteIds(selectedIds)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          删除{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </Button>
      </div>

      {/* 内容 */}
      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title="这里还是空的"
          description={
            keyword
              ? `没有匹配「${keyword}」的条目。点搜索旁 × 清除，或换关键词。`
              : "点上方「每日同步」拉取素材，或粘贴链接收录。点「全部」可离开当前平台筛选。"
          }
        />
      ) : viewMode === "list" ? (
        <ul className="divide-y divide-[var(--kp-border)] overflow-hidden rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)]">
          {items.map((item: InboxItem) => {
            const meta = itemMeta(item);
            const on = selected.has(item.id);
            return (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  onClick={() => toggleSelect(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelect(item.id);
                    }
                  }}
                  className={cn(
                    "group flex cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition",
                    on
                      ? "bg-[var(--kp-brand-soft)] ring-1 ring-inset ring-[var(--kp-brand)]"
                      : "hover:bg-[var(--kp-bg-mute)]/50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on
                        ? "border-[var(--kp-brand-deep)] bg-[var(--kp-brand-deep)] text-white"
                        : "border-[var(--kp-border)] bg-[var(--kp-surface)] text-transparent",
                    )}
                    aria-hidden
                  >
                    {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="truncate text-sm font-medium text-[var(--kp-text-1)]">
                      {item.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <MetaPill tone="brand">{meta.sourceLabel}</MetaPill>
                      <MetaPill
                        tone={
                          item.status === "fetched"
                            ? "warn"
                            : item.status === "distilled"
                              ? "ok"
                              : "mute"
                        }
                      >
                        {meta.statusLabel}
                      </MetaPill>
                      {meta.collection ? <MetaPill>{meta.collection}</MetaPill> : null}
                      {meta.kindHint ? <MetaPill>{meta.kindHint}</MetaPill> : null}
                      {meta.author ? <MetaPill>{meta.author}</MetaPill> : null}
                      {meta.hasBody ? <MetaPill>有摘要</MetaPill> : <MetaPill>仅标题</MetaPill>}
                      {meta.distilled ? <MetaPill tone="ok">已蒸馏</MetaPill> : null}
                      {meta.tags.map((t) => (
                        <MetaPill key={t}>{t}</MetaPill>
                      ))}
                    </div>
                    {item.excerpt ? (
                      <p className="line-clamp-2 text-xs text-[var(--kp-text-3)]">{item.excerpt}</p>
                    ) : null}
                  </div>
                  <div
                    className="flex shrink-0 flex-col items-end gap-1 pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span
                      className="text-[11px] tabular-nums text-[var(--kp-text-3)]"
                      title={meta.isSourceTime ? "原帖时间" : "收录时间"}
                    >
                      {meta.timeLabel}
                    </span>
                    <InboxItemActions
                      item={item}
                      onDelete={() => setPendingDeleteIds([item.id])}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item: InboxItem) => {
            const meta = itemMeta(item);
            const on = selected.has(item.id);
            return (
              <article
                key={item.id}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                onClick={() => toggleSelect(item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleSelect(item.id);
                  }
                }}
                className={cn(
                  "group flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 text-left transition",
                  on
                    ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] shadow-[0_0_0_1px_var(--kp-brand)]"
                    : "border-[var(--kp-border)] bg-[var(--kp-surface)] hover:border-[color-mix(in_oklab,var(--kp-brand)_35%,var(--kp-border))]",
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on
                        ? "border-[var(--kp-brand-deep)] bg-[var(--kp-brand-deep)] text-white"
                        : "border-[var(--kp-border)] bg-[var(--kp-surface)] text-transparent",
                    )}
                    aria-hidden
                  >
                    {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <MetaPill tone="brand">{meta.sourceLabel}</MetaPill>
                      <MetaPill
                        tone={
                          item.status === "fetched"
                            ? "warn"
                            : item.status === "distilled"
                              ? "ok"
                              : "mute"
                        }
                      >
                        {meta.statusLabel}
                      </MetaPill>
                      {meta.kindHint ? <MetaPill>{meta.kindHint}</MetaPill> : null}
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--kp-text-1)]">
                      {item.title}
                    </h3>
                    {item.excerpt ? (
                      <p className="line-clamp-3 text-xs leading-relaxed text-[var(--kp-text-3)]">
                        {item.excerpt}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {meta.author ? <MetaPill>{meta.author}</MetaPill> : null}
                      {meta.hasBody ? <MetaPill>有摘要</MetaPill> : <MetaPill>仅标题</MetaPill>}
                      {meta.distilled ? <MetaPill tone="ok">已蒸馏</MetaPill> : null}
                      {meta.tags.map((t) => (
                        <MetaPill key={t}>{t}</MetaPill>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-[var(--kp-text-3)]">
                      <span title={meta.isSourceTime ? "原帖时间" : "收录时间"} className="tabular-nums">
                        {meta.timeLabel}
                      </span>
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <InboxItemActions
                          item={item}
                          onDelete={() => setPendingDeleteIds([item.id])}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data && data.totalPages > 1 ? (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          onPageChange={setPage}
        />
      ) : null}

      <ConfirmDialog
        isOpen={!!pendingDeleteIds?.length}
        title={
          (pendingDeleteIds?.length ?? 0) > 1
            ? `删除 ${pendingDeleteIds!.length} 条 Inbox 条目？`
            : "删除 Inbox 条目？"
        }
        description="仅删除队列记录，已蒸馏的文章不会删除。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={() => {
          const ids = pendingDeleteIds ?? [];
          setPendingDeleteIds(null);
          if (!ids.length) return;
          runAction("删除", async () => {
            if (ids.length === 1) {
              await deleteMutation.mutateAsync({ id: ids[0]! });
            } else {
              await bulkDeleteMutation.mutateAsync({ ids });
            }
          }).catch(catchUnlessCancelled("inbox.delete"));
        }}
        onCancel={() => setPendingDeleteIds(null)}
      />
    </AdminPage>
  );
}
