/**
 * 信息源配置页面 — 参考 MetaBlog TrustedSourceManager
 */

"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ExternalLink,
  Globe,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InfoSource } from "@knowpilot/shared";
import { useInfoSource, useNativeCapabilities } from "@/lib/hooks";
import { EmptyState, KpSelect, LoadingState, ConfirmDialog, Pagination, NativeCapabilitiesPanel, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

type SourceForm = {
  name: string;
  url: string;
  type: string;
  description: string;
  reliability: number;
  language: string;
  tags: string;
  enabled: boolean;
  fetchInterval: number | null;
};

const TYPE_OPTIONS = [
  { value: "general", label: "通用" },
  { value: "blog", label: "博客" },
  { value: "paper", label: "论文" },
  { value: "news", label: "新闻" },
  { value: "official", label: "官方" },
  { value: "community", label: "社区" },
  { value: "rss", label: "RSS" },
] as const;

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动检测" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英文" },
];

const EMPTY_FORM: SourceForm = {
  name: "",
  url: "",
  type: "general",
  description: "",
  reliability: 3,
  language: "auto",
  tags: "",
  enabled: true,
  fetchInterval: null,
};

function ReliabilityStars({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            size === "md" ? "h-4 w-4" : "h-3 w-3",
            n <= value ? "fill-amber-400 text-amber-400" : "text-[var(--kp-text-3)]/30",
          )}
        />
      ))}
    </span>
  );
}

export default function SourcesPage() {
  const { useList, useCreate, useUpdate, useDelete, useFetch, useFetchDue } = useInfoSource();
  const fetchMutation = useFetch();
  const fetchDueMutation = useFetchDue();

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [minReliability, setMinReliability] = useState<number | undefined>(undefined);
  const [tagFilter, setTagFilter] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<boolean | undefined>(undefined);

  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  const listInput = {
    page,
    pageSize: 12,
    keyword: keyword || undefined,
    type: (typeFilter || undefined) as InfoSource["type"] | undefined,
    minReliability,
    tag: tagFilter || undefined,
    enabled: enabledFilter,
  };

  const { data, isLoading, refetch } = useList(listInput);
  const { data: caps } = useNativeCapabilities();
  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const deleteMutation = useDelete();

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of data?.items ?? []) {
      for (const t of item.tags ?? []) tags.add(t);
    }
    return Array.from(tags).sort();
  }, [data?.items]);

  const enabledSourceCount = useMemo(
    () => (data?.items ?? []).filter((s: InfoSource) => s.enabled).length,
    [data?.items],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setView("edit");
  };

  const openEdit = (source: InfoSource) => {
    setEditingId(source.id);
    setForm({
      name: source.name,
      url: source.url,
      type: source.type,
      description: source.description ?? "",
      reliability: source.reliability,
      language: source.language,
      tags: (source.tags ?? []).join(", "),
      enabled: source.enabled,
      fetchInterval: source.fetchInterval ?? null,
    });
    setView("edit");
  };

  const parseTags = (raw: string) =>
    raw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

  const handleSave = async () => {
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      type: form.type as InfoSource["type"],
      description: form.description.trim(),
      reliability: form.reliability,
      language: form.language,
      tags: parseTags(form.tags),
      enabled: form.enabled,
      fetchInterval: form.fetchInterval,
    };
    if (!payload.name || !payload.url) return;

    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setView("list");
    void refetch();
  };

  const handleSearch = () => {
    setKeyword(searchInput.trim());
    setPage(1);
  };

  const toggleEnabled = (source: InfoSource) => {
    updateMutation.mutate({ id: source.id, enabled: !source.enabled });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
      if (editingId === deleteId) setView("list");
    }
  };

  if (view === "edit") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
        <button
          type="button"
          onClick={() => setView("list")}
          className="mb-6 flex items-center gap-1 text-sm text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回信息源列表
        </button>

        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)]">
              {editingId ? "编辑信息源" : "新建信息源"}
            </h1>
            <p className="mt-1 text-sm text-[var(--kp-text-3)]">
              配置 Agent 可引用的可信信息来源，同步至 content/sources/*.json。
            </p>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DeepSeek 官方博客" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">URL</label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">类型</label>
                <KpSelect
                  value={form.type}
                  onChange={(type) => setForm({ ...form, type })}
                  options={[...TYPE_OPTIONS]}
                  className="w-full"
                  aria-label="信息源类型"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">语言</label>
                <KpSelect
                  value={form.language}
                  onChange={(language) => setForm({ ...form, language })}
                  options={LANGUAGE_OPTIONS}
                  className="w-full"
                  aria-label="内容语言"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">
                可信度（1-5）
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={form.reliability}
                  onChange={(e) => setForm({ ...form, reliability: Number(e.target.value) })}
                  className="flex-1 accent-[var(--kp-brand)]"
                />
                <ReliabilityStars value={form.reliability} size="md" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">描述</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                placeholder="简要说明该信息源的用途与特点"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">标签</label>
              <Input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="AI, 官方, 技术（逗号分隔）"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--kp-text-2)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded accent-[var(--kp-brand)]"
              />
              启用此信息源
            </label>
            {form.type === "rss" && (
              <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-4">
                <label className="mb-2 block text-xs font-medium text-[var(--kp-text-3)]">
                  自动抓取间隔（分钟）
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={10080}
                    step={5}
                    value={form.fetchInterval ?? 60}
                    onChange={(e) => setForm({ ...form, fetchInterval: Number(e.target.value) })}
                    disabled={!form.enabled}
                    className="flex-1 accent-[var(--kp-brand)]"
                  />
                  <span className="w-16 text-right text-xs text-[var(--kp-text-2)]">
                    {form.fetchInterval ?? 60} 分
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--kp-text-3)]">
                  留空或设为 0 表示不自动抓取；仅 type=RSS 时生效。
                </p>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--kp-text-3)]">
                  <input
                    type="checkbox"
                    checked={form.fetchInterval === null}
                    onChange={(e) => setForm({ ...form, fetchInterval: e.target.checked ? null : 60 })}
                    className="rounded accent-[var(--kp-brand)]"
                  />
                  不自动抓取
                </label>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button onClick={() => void handleSave()} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingId ? "保存修改" : "创建信息源"}
            </Button>
            {editingId && (
              <Button variant="destructive" onClick={() => setDeleteId(editingId)}>
                <Trash2 className="mr-1 h-4 w-4" />
                删除
              </Button>
            )}
          </div>
        </div>

        <ConfirmDialog
          isOpen={deleteId !== null}
          title="删除信息源"
          description="确定删除此信息源？本地 content/sources/ 文件也会一并移除。"
          isDestructive
          confirmLabel="确认删除"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={Globe}
        title="信息源管理"
        description="维护 Agent 检索与引用时可信任的外部来源。支持按类型、可信度与标签筛选，配置同步至 content/sources/。"
        action={{ label: "新建信息源", onClick: openCreate, icon: Plus }}
      />
      <div className="-mt-4 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchDueMutation.mutateAsync({})}
          disabled={fetchDueMutation.isPending}
          className="gap-1 text-xs"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", fetchDueMutation.isPending && "animate-spin")} />
          抓取全部到期 RSS
        </Button>
      </div>

      {caps && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <NativeCapabilitiesPanel
            data={caps}
            compact
            title="web_search 与 read_article"
            showSearchEnginesInCompact
            detailHref="/tools"
            detailLabel="完整能力"
          />
          {!isLoading && data && (
            <p className="text-[10px] text-[var(--kp-text-3)] px-1">
              全局已启用 {caps.infoSources?.enabled ?? "—"} 条 · 本页 {enabledSourceCount}/{data.total} 条 · web_search 在 Tavily 等引擎下可 scoped 到信息源域名
            </p>
          )}
        </motion.div>
      )}

      {/* 筛选栏 */}
      <div className="space-y-3 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="搜索名称、URL、描述或标签..."
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={handleSearch}>
            搜索
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--kp-text-3)]">类型</span>
          <button
            type="button"
            onClick={() => { setTypeFilter(""); setPage(1); }}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              !typeFilter
                ? "bg-[var(--kp-brand)] text-white"
                : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]",
            )}
          >
            全部
          </button>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setTypeFilter(opt.value); setPage(1); }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                typeFilter === opt.value
                  ? "bg-[var(--kp-brand)] text-white"
                  : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--kp-text-3)]">最低可信度</span>
          {[undefined, 3, 4, 5].map((level) => (
            <button
              key={String(level ?? "all")}
              type="button"
              onClick={() => { setMinReliability(level); setPage(1); }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                minReliability === level
                  ? "bg-[var(--kp-brand)] text-white"
                  : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]",
              )}
            >
              {level === undefined ? "不限" : `${level}+ 星`}
            </button>
          ))}

          <span className="ml-2 text-xs text-[var(--kp-text-3)]">状态</span>
          {[
            { value: undefined, label: "全部" },
            { value: true, label: "已启用" },
            { value: false, label: "已禁用" },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => { setEnabledFilter(opt.value); setPage(1); }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                enabledFilter === opt.value
                  ? "bg-[var(--kp-brand)] text-white"
                  : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]",
              )}
            >
              {opt.label}
            </button>
          ))}

          {allTags.length > 0 && (
            <>
              <span className="ml-2 text-xs text-[var(--kp-text-3)]">标签</span>
              <KpSelect
                value={tagFilter || "__all__"}
                onChange={(v) => { setTagFilter(v === "__all__" ? "" : v); setPage(1); }}
                options={[
                  { value: "__all__", label: "全部标签" },
                  ...allTags.map((t) => ({ value: t, label: t })),
                ]}
                size="sm"
                variant="capsule"
                aria-label="按标签筛选"
              />
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <LoadingState count={6} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="尚无信息源"
          description="添加第一个可信信息来源，供 Agent 检索与引用时优先使用。"
          actionLabel="新建信息源"
          onAction={openCreate}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((source: InfoSource, idx: number) => (
              <motion.div
                key={source.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.04, type: "spring", stiffness: 200, damping: 20 },
                }}
                className="group flex flex-col rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)]/60 p-5 transition-all hover:border-[var(--kp-divider)] hover:shadow-lg"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                      {source.type === "rss" ? <Rss className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => openEdit(source)}
                        className="text-left text-sm font-bold text-[var(--kp-text-1)] hover:text-[var(--kp-brand-dark)]"
                      >
                        {source.name}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]">
                          {TYPE_LABELS[source.type] ?? source.type}
                        </span>
                        <ReliabilityStars value={source.reliability} />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleEnabled(source)}
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                      source.enabled
                        ? "bg-green-500/10 text-green-600"
                        : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
                    )}
                  >
                    {source.enabled ? "已启用" : "已禁用"}
                  </button>
                </div>

                {source.description && (
                  <p className="mb-3 line-clamp-2 text-xs text-[var(--kp-text-3)]">{source.description}</p>
                )}

                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-3 flex items-center gap-1 truncate text-[11px] text-[var(--kp-brand-deep)] hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {source.url}
                </a>

                {source.tags?.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1">
                    {source.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 rounded bg-[var(--kp-bg-soft)] px-1.5 py-0.5 text-[8px] text-[var(--kp-text-3)]"
                      >
                        <Tag className="h-2 w-2" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto space-y-2 border-t border-[var(--kp-divider-light)] pt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--kp-text-3)]">
                        {source.language === "zh" ? "中文" : source.language === "en" ? "英文" : "自动"}
                        {source.type === "rss" && source.fetchInterval && (
                          <span className="ml-2">· 每 {source.fetchInterval} 分抓取</span>
                        )}
                      </span>
                      {source.type === "rss" && source.lastFetchedAt && (
                        <span
                          className={cn(
                            "text-[10px]",
                            source.lastFetchStatus === "error"
                              ? "text-red-500"
                              : source.lastFetchStatus === "success"
                                ? "text-green-600"
                                : "text-[var(--kp-text-3)]",
                          )}
                        >
                          {source.lastFetchStatus === "success" && "✓ "}
                          {source.lastFetchStatus === "error" && "✗ "}
                          上次抓取 {new Date(source.lastFetchedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {source.lastFetchError ? ` · ${source.lastFetchError.slice(0, 40)}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {source.type === "rss" && (
                        <button
                          type="button"
                          onClick={async () => {
                            setFetchingId(source.id);
                            try {
                              await fetchMutation.mutateAsync({ id: source.id });
                            } finally {
                              setFetchingId(null);
                            }
                          }}
                          disabled={fetchingId === source.id || fetchMutation.isPending}
                          className="flex items-center gap-1 text-xs text-[var(--kp-brand-deep)] hover:underline disabled:opacity-50"
                        >
                          <RefreshCw className={cn("h-3 w-3", fetchingId === source.id && "animate-spin")} />
                          抓取
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEdit(source)}
                        className="text-xs text-[var(--kp-brand-deep)] hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(source.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {data && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="删除信息源"
        description="确定删除此信息源？本地 content/sources/ 文件也会一并移除。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
