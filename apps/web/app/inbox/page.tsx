/**
 * 知识 Inbox — 截图 / 知乎 / 小红书 / 微信公众号待消化素材
 */

"use client";

import { useMemo, useState } from "react";
import {
  ExternalLink,
  ImageIcon,
  Inbox,
  RefreshCw,
  Sparkles,
  Trash2,
  BookMarked,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InboxItem } from "@knowpilot/shared";
import { useInbox } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination, PageHeader, KpSelect } from "@/components/shared";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

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

export default function InboxPage() {
  const {
    useList,
    useDelete,
    useStats,
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
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("fetched");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [zhihuUrl, setZhihuUrl] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const listInput = {
    page,
    pageSize: 20,
    keyword: keyword || undefined,
    source: (sourceFilter || undefined) as InboxItem["source"] | undefined,
    status: (statusFilter || undefined) as InboxItem["status"] | undefined,
    orderBy: "capturedAt" as const,
    order: "desc" as const,
  };

  const { data, isLoading, refetch } = useList(listInput);
  const { data: stats, refetch: refetchStats } = useStats();
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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const refreshAll = () => {
    refetch().catch(() => {});
    refetchStats().catch(() => {});
    utils.inbox.list.invalidate().catch(() => {});
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      const res = await fn();
      showToast(`${label}完成`);
      setSelected(new Set());
      refreshAll();
      return res;
    } catch (err) {
      showToast(`${label}失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="知识 Inbox"
        description="截图 · 知乎收藏 · 小红书收藏 · 微信公众号 → 待消化 → 蒸馏进知识库"
        icon={Inbox}
      />

      {toast && (
        <div className="mb-4 rounded-lg border border-[var(--kp-border)] bg-[var(--kp-surface)] px-3 py-2 text-sm">
          {toast}
        </div>
      )}

      {/* 统计 */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "待消化", value: stats?.fetched ?? 0 },
          { label: "已成文", value: stats?.distilled ?? 0 },
          { label: "已忽略", value: stats?.ignored ?? 0 },
          { label: "总计", value: stats?.total ?? 0 },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] px-4 py-3">
            <div className="text-xs text-[var(--kp-text-3)]">{s.label}</div>
            <div className="kp-stat-number mt-1 text-2xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 操作条 */}
      <div className="mb-6 space-y-3 rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => runAction("扫描截图", () => scanMutation.mutateAsync({}))}
          >
            <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
            扫描截图
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => runAction("同步小红书", () => syncXhsMutation.mutateAsync({ maxItems: 50 }))}
          >
            <BookMarked className="mr-1.5 h-3.5 w-3.5" />
            同步小红书收藏
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => runAction("读微信链接", () => wechatMutation.mutateAsync({}))}
          >
            读 wechat/links.txt
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => refreshAll()}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "animate-spin")} />
            刷新
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="知乎收藏夹 URL，如 https://www.zhihu.com/collection/123"
            value={zhihuUrl}
            onChange={(e) => setZhihuUrl(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!!busy || !zhihuUrl.trim()}
            onClick={() =>
              runAction("同步知乎", () =>
                syncZhihuMutation.mutateAsync({ collectionUrl: zhihuUrl.trim(), maxItems: 50 }),
              )
            }
          >
            同步知乎收藏夹
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="粘贴单篇链接（微信公众号 / 知乎 / 小红书 / 任意网页）"
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
          />
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
            收录
          </Button>
        </div>

        <p className="text-xs text-[var(--kp-text-3)]">
          截图目录：{stats?.screenshotWatchDir || "data/inbox/screenshots/drop"} · 蒸馏花园：
          {stats?.defaultGarden || "knowledge"} · 平台收藏需先在 Chat 用 platform_login 登录
        </p>
      </div>

      {/* 筛选 + 批量 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="搜索标题/正文"
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
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            { value: "", label: "全部来源" },
            ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <KpSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "", label: "全部状态" },
            ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Button
          size="sm"
          disabled={!selectedIds.length || !!busy}
          onClick={() => runAction("蒸馏", () => distillMutation.mutateAsync({ ids: selectedIds }))}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          蒸馏选中 ({selectedIds.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedIds.length || !!busy}
          onClick={() => runAction("忽略", () => ignoreMutation.mutateAsync({ ids: selectedIds }))}
        >
          忽略选中
        </Button>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title="Inbox 是空的"
          description="把截图丢进 data/inbox/screenshots/drop，或同步知乎/小红书收藏，或粘贴微信公众号链接。"
        />
      ) : (
        <div className="space-y-2">
          {items.map((item: InboxItem) => (
            <div
              key={item.id}
              className={cn(
                "flex gap-3 rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-4 transition",
                selected.has(item.id) && "ring-1 ring-[var(--kp-brand)]",
              )}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(item.id)}
                onChange={() => toggleSelect(item.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="kp-badge">{SOURCE_LABELS[item.source] || item.source}</span>
                  <span className="kp-badge">{STATUS_LABELS[item.status] || item.status}</span>
                  <h3 className="truncate font-medium">{item.title}</h3>
                </div>
                {item.excerpt && (
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--kp-text-2)]">{item.excerpt}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--kp-text-3)]">
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-[var(--kp-brand)]"
                    >
                      <ExternalLink className="h-3 w-3" />
                      原文
                    </a>
                  )}
                  {item.contentPath && <span>本地: {item.contentPath}</span>}
                  <span>{new Date(item.capturedAt).toLocaleString()}</span>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setDeleteId(item.id)} title="删除">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {data && (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          onPageChange={setPage}
        />
      )}

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
    </div>
  );
}
