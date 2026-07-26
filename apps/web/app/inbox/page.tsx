/**
 * 知识 Inbox — 按平台 / 知乎收藏夹 / 小红书点赞·收藏浏览与蒸馏
 */

"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  ImageIcon,
  Inbox,
  RefreshCw,
  Sparkles,
  Trash2,
  BookMarked,
  Heart,
  FolderOpen,
  Link2,
  ChevronRight,
  Loader2,
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
import { trpc } from "@/lib/trpc";

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };

const SOURCE_LABELS: Record<string, string> = {
  screenshot: "截图",
  zhihu: "知乎",
  xhs: "小红书",
  wechat: "微信",
  url: "链接",
};

const STATUS_LABELS: Record<string, string> = {
  fetched: "待消化",
  distilled: "已成文",
  ignored: "已忽略",
};

type BrowseKey =
  | { type: "all" }
  | { type: "source"; source: string }
  | { type: "zhihuCollection"; collectionId: string }
  | { type: "xhsTag"; tag: "like" | "favorite" };

function browseEquals(a: BrowseKey, b: BrowseKey): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "all" && b.type === "all") return true;
  if (a.type === "source" && b.type === "source") return a.source === b.source;
  if (a.type === "zhihuCollection" && b.type === "zhihuCollection") {
    return a.collectionId === b.collectionId;
  }
  if (a.type === "xhsTag" && b.type === "xhsTag") return a.tag === b.tag;
  return false;
}

function itemCollectionTitle(item: InboxItem): string | null {
  const t = item.metadata?.collectionTitle;
  return typeof t === "string" && t.trim() ? t : null;
}

export default function InboxPage() {
  const {
    useList,
    useDelete,
    useStats,
    useFacets,
    useScanScreenshots,
    useSyncXhs,
    useIngestWechat,
    useDistill,
    useIgnore,
    useCaptureUrl,
    useSyncZhihu,
  } = useInbox();

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [browse, setBrowse] = useState<BrowseKey>({ type: "all" });
  const [statusFilter, setStatusFilter] = useState("fetched");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [zhihuUrl, setZhihuUrl] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const listInput = useMemo(() => {
    const base = {
      page,
      pageSize: 24,
      keyword: keyword || undefined,
      status: (statusFilter || undefined) as InboxItem["status"] | undefined,
      orderBy: "capturedAt" as const,
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
    return base;
  }, [page, keyword, statusFilter, browse]);

  const { data, isLoading, refetch } = useList(listInput);
  const { data: stats, refetch: refetchStats } = useStats();
  const { data: facets, refetch: refetchFacets } = useFacets(
    statusFilter ? { status: statusFilter } : {},
  );
  const deleteMutation = useDelete();
  const scanMutation = useScanScreenshots();
  const syncXhsMutation = useSyncXhs();
  const wechatMutation = useIngestWechat();
  const distillMutation = useDistill();
  const ignoreMutation = useIgnore();
  const captureMutation = useCaptureUrl();
  const syncZhihuMutation = useSyncZhihu();
  const utils = trpc.useUtils();

  const items = data?.items ?? [];
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4200);
  };

  const refreshAll = () => {
    refetch().catch(() => {});
    refetchStats().catch(() => {});
    refetchFacets().catch(() => {});
    utils.inbox.list.invalidate().catch(() => {});
  };

  const setBrowseAndReset = (next: BrowseKey) => {
    setBrowse(next);
    setPage(1);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      const res = await fn();
      const sync = res as {
        created?: number;
        updated?: number;
        errors?: string[];
        collectionsDiscovered?: number;
        collectionsSynced?: number;
        byKind?: Partial<
          Record<
            "liked" | "collect",
            { scanned: number; created: number; updated: number; stoppedEarly?: boolean }
          >
        >;
        byCollection?: Array<{ stoppedEarly?: boolean }>;
      } | null;
      let detail = "";
      if (sync?.byKind) {
        const parts: string[] = [];
        if (sync.byKind.liked) {
          parts.push(`点赞新${sync.byKind.liked.created}`);
        }
        if (sync.byKind.collect) {
          parts.push(`收藏新${sync.byKind.collect.created}`);
        }
        if (parts.length) detail = `：${parts.join(" · ")}`;
      } else if (typeof sync?.collectionsDiscovered === "number") {
        detail = `：${sync.collectionsSynced ?? 0} 夹 · 新 ${sync.created ?? 0}`;
      } else if (typeof sync?.created === "number") {
        detail = `：新 ${sync.created}`;
      }
      const errHint = sync?.errors?.length ? `（${sync.errors[0]}）` : "";
      showToast(`${label}完成${detail}${errHint}`);
      setSelected(new Set());
      refreshAll();
      return res;
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
    const col = facets?.zhihuCollections?.find((c) => c.id === browse.collectionId);
    return col ? `知乎 · ${col.title}` : "知乎 · 收藏夹";
  }, [browse, facets]);

  const railBtn = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
      active
        ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)] shadow-sm"
        : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
    );

  return (
    <AdminPage className="!max-w-[1600px]">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="relative overflow-hidden rounded-3xl border border-[var(--kp-border)] bg-[var(--kp-surface)]"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 12% 20%, color-mix(in oklab, var(--kp-brand) 22%, transparent), transparent 55%), radial-gradient(ellipse 70% 50% at 88% 0%, color-mix(in oklab, var(--kp-brand) 10%, transparent), transparent 50%)",
          }}
        />
        <div className="relative flex flex-col gap-5 p-6 md:flex-row md:items-end md:justify-between md:p-8">
          <div className="min-w-0">
            <p className="kp-eyebrow">Knowledge Intake</p>
            <h1 className="kp-display mt-2 text-3xl text-[var(--kp-text-1)] md:text-4xl">Inbox</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--kp-text-2)] md:text-base">
              截图、知乎收藏夹、小红书点赞与收藏 — 按来源浏览，勾选后蒸馏进知识库。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() => setSyncOpen((v) => !v)}
              className="shadow-sm"
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              同步素材
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedIds.length || !!busy}
              onClick={() => runAction("蒸馏", () => distillMutation.mutateAsync({ ids: selectedIds }))}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              蒸馏 ({selectedIds.length})
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="relative grid grid-cols-2 gap-px border-t border-[var(--kp-border)] bg-[var(--kp-border)] sm:grid-cols-4">
          {[
            { label: "待消化", value: stats?.fetched ?? 0 },
            { label: "已成文", value: stats?.distilled ?? 0 },
            { label: "已忽略", value: stats?.ignored ?? 0 },
            { label: "总计", value: stats?.total ?? 0 },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: 0.04 * i }}
              className="bg-[var(--kp-surface)] px-5 py-4"
            >
              <div className="text-[11px] font-medium tracking-wide text-[var(--kp-text-3)]">{s.label}</div>
              <div className="kp-stat-number mt-1 text-2xl">{s.value}</div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] px-4 py-2.5 text-sm shadow-sm"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sync panel */}
      <AnimatePresence>
        {syncOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="kp-card-premium space-y-4 rounded-2xl p-5">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runAction("扫描截图", () => scanMutation.mutateAsync({}))}>
                  <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                  扫描截图
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runAction("同步知乎增量", () => syncZhihuMutation.mutateAsync({ mode: "incremental" }))}>
                  <BookMarked className="mr-1.5 h-3.5 w-3.5" />
                  知乎增量
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runAction("同步知乎全量", () => syncZhihuMutation.mutateAsync({ mode: "full" }))}>
                  知乎全量
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runAction("同步小红书增量", () => syncXhsMutation.mutateAsync({ mode: "incremental", kinds: ["liked", "collect"] }))}>
                  <Heart className="mr-1.5 h-3.5 w-3.5" />
                  小红书增量
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runAction("同步小红书全量", () => syncXhsMutation.mutateAsync({ mode: "full", kinds: ["liked", "collect"], maxItems: 2000 }))}>
                  小红书全量
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runAction("读微信链接", () => wechatMutation.mutateAsync({}))}>
                  微信 links.txt
                </Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="只同步某一个知乎收藏夹 URL" value={zhihuUrl} onChange={(e) => setZhihuUrl(e.target.value)} />
                <Button size="sm" disabled={!!busy || !zhihuUrl.trim()} onClick={() => runAction("同步知乎单夹", () => syncZhihuMutation.mutateAsync({ collectionUrl: zhihuUrl.trim(), mode: "incremental", maxItems: 200 }))}>
                  同步该夹
                </Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="粘贴单篇链接收录" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} />
                <Button
                  size="sm"
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
              <p className="text-xs text-[var(--kp-text-3)]">
                截图目录 {stats?.screenshotWatchDir || "data/inbox/screenshots/drop"} · 蒸馏花园{" "}
                {stats?.defaultGarden || "knowledge"} · 平台需先 Chat 里 platform_login
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body: rail + list */}
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <motion.aside
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={SPRING}
          className="kp-card-premium h-fit space-y-4 rounded-2xl p-3 lg:sticky lg:top-20"
        >
          <div>
            <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-[var(--kp-text-3)] uppercase">
              浏览
            </p>
            <button type="button" className={railBtn(browseEquals(browse, { type: "all" }))} onClick={() => setBrowseAndReset({ type: "all" })}>
              <Inbox className="h-4 w-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">全部</span>
              <span className="text-xs tabular-nums opacity-60">{facets?.total ?? stats?.total ?? 0}</span>
            </button>
          </div>

          <div>
            <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-[var(--kp-text-3)] uppercase">
              平台
            </p>
            <div className="space-y-0.5">
              {(["zhihu", "xhs", "wechat", "screenshot", "url"] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  className={railBtn(browseEquals(browse, { type: "source", source: src }))}
                  onClick={() => setBrowseAndReset({ type: "source", source: src })}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{SOURCE_LABELS[src]}</span>
                  <span className="text-xs tabular-nums opacity-60">{facets?.bySource?.[src] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {(facets?.zhihuCollections?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-[var(--kp-text-3)] uppercase">
                知乎收藏夹
              </p>
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {facets!.zhihuCollections.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    className={railBtn(
                      browseEquals(browse, { type: "zhihuCollection", collectionId: col.id }),
                    )}
                    onClick={() => setBrowseAndReset({ type: "zhihuCollection", collectionId: col.id })}
                    title={col.title}
                  >
                    <BookMarked className="h-4 w-4 shrink-0 opacity-70" />
                    <span className="flex-1 truncate">{col.title}</span>
                    <span className="text-xs tabular-nums opacity-60">{col.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {((facets?.xhs?.like ?? 0) > 0 || (facets?.xhs?.favorite ?? 0) > 0) && (
            <div>
              <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-[var(--kp-text-3)] uppercase">
                小红书
              </p>
              <div className="space-y-0.5">
                <button
                  type="button"
                  className={railBtn(browseEquals(browse, { type: "xhsTag", tag: "like" }))}
                  onClick={() => setBrowseAndReset({ type: "xhsTag", tag: "like" })}
                >
                  <Heart className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">点赞</span>
                  <span className="text-xs tabular-nums opacity-60">{facets?.xhs?.like ?? 0}</span>
                </button>
                <button
                  type="button"
                  className={railBtn(browseEquals(browse, { type: "xhsTag", tag: "favorite" }))}
                  onClick={() => setBrowseAndReset({ type: "xhsTag", tag: "favorite" })}
                >
                  <BookMarked className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">收藏</span>
                  <span className="text-xs tabular-nums opacity-60">{facets?.xhs?.favorite ?? 0}</span>
                </button>
              </div>
            </div>
          )}
        </motion.aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-[var(--kp-text-2)]">
              <Inbox className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
              <span className="truncate font-medium text-[var(--kp-text-1)]">{breadcrumb}</span>
              {data && (
                <span className="shrink-0 text-xs text-[var(--kp-text-3)]">· {data.total} 条</span>
              )}
            </div>
            <Input
              className="max-w-xs"
              placeholder="搜索标题 / 正文 / 收藏夹"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setKeyword(searchInput.trim());
                  setPage(1);
                }
              }}
            />
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
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedIds.length || !!busy}
              onClick={() => runAction("忽略", () => ignoreMutation.mutateAsync({ ids: selectedIds }))}
            >
              忽略
            </Button>
          </div>

          {isLoading ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <EmptyState
              title="这里还是空的"
              description="点上方「同步素材」拉知乎/小红书，或把截图丢进 drop 目录。左侧可按收藏夹筛选。"
            />
          ) : (
            <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {items.map((item: InboxItem, index: number) => {
                  const colTitle = itemCollectionTitle(item);
                  const isXhsLike = item.source === "xhs" && item.tags?.includes("like");
                  const isXhsFav = item.source === "xhs" && item.tags?.includes("favorite");
                  return (
                    <motion.article
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ ...SPRING, delay: Math.min(index * 0.03, 0.24) }}
                      whileHover={{ y: -3 }}
                      className={cn(
                        "group relative flex flex-col rounded-2xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-4 shadow-sm transition",
                        "hover:border-[color-mix(in_oklab,var(--kp-brand)_35%,var(--kp-border))]",
                        selected.has(item.id) && "ring-2 ring-[var(--kp-brand)] ring-offset-2 ring-offset-[var(--kp-bg)]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-[var(--kp-brand)]"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          aria-label={`选择 ${item.title}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-1.5">
                            <span className="kp-badge kp-badge-info">
                              {SOURCE_LABELS[item.source] || item.source}
                            </span>
                            {colTitle && <span className="kp-badge">{colTitle}</span>}
                            {isXhsLike && <span className="kp-badge">点赞</span>}
                            {isXhsFav && <span className="kp-badge">收藏</span>}
                            <span
                              className={cn(
                                "kp-badge",
                                item.status === "fetched" && "kp-badge-warning",
                                item.status === "distilled" && "kp-badge-success",
                              )}
                            >
                              {STATUS_LABELS[item.status] || item.status}
                            </span>
                          </div>
                          <h3 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--kp-text-1)]">
                            {item.title}
                          </h3>
                          {item.excerpt && (
                            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--kp-text-3)]">
                              {item.excerpt}
                            </p>
                          )}
                          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--kp-text-3)]">
                            <span>{new Date(item.capturedAt).toLocaleString()}</span>
                            <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                              {item.url && (
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand)]"
                                  title="打开原文"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              <button
                                type="button"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-mute)] hover:text-red-600"
                                title="删除"
                                onClick={() => setDeleteId(item.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}

          {data && data.totalPages > 1 && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteId}
        title="删除 Inbox 条目？"
        description="仅删除队列记录，已蒸馏的文章不会删除。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={() => {
          if (deleteId) {
            deleteMutation.mutate({ id: deleteId });
            setDeleteId(null);
            refreshAll();
          }
        }}
        onCancel={() => setDeleteId(null)}
      />
    </AdminPage>
  );
}
