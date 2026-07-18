"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Copy, Check, ExternalLink, RefreshCw, Sparkles, Radio, Search } from "lucide-react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingState, KpSelect, Pagination } from "@/components/shared";
import { cn } from "@/lib/utils";

const OPENROUTER_PAGE_SIZE = 10;
const FREELLM_PAGE_SIZE = 10;

function formatContext(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function isMultimodal(modality?: string): boolean {
  if (!modality) return false;
  return modality !== "text" && modality !== "text->text";
}

function formatModality(modality?: string): string {
  if (!modality) return "text";
  return modality.replace("->", "→");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "brand";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide",
        tone === "neutral" && "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]",
        tone === "ok" && "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
        tone === "warn" && "bg-amber-500/15 text-amber-800 dark:text-amber-300",
        tone === "brand" && "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
      )}
    >
      {children}
    </span>
  );
}

function CopyIdButton({
  id,
  copied,
  onCopy,
}: {
  id: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title="复制模型 id"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors",
        "text-[var(--kp-text-2)] hover:bg-[var(--kp-brand-soft)] hover:text-[var(--kp-brand-deep)]",
        copied && "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
      )}
    >
      {copied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0 opacity-70" />}
      <span className="max-w-[16rem] truncate sm:max-w-[22rem]">{id}</span>
    </button>
  );
}

export function FreeModelsPanel() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [modality, setModality] = useState<"all" | "text" | "multimodal">("all");
  const [sort, setSort] = useState<"context_desc" | "context_asc" | "name">("context_desc");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedDesc, setExpandedDesc] = useState<Record<string, boolean>>({});
  const [orPage, setOrPage] = useState(1);
  const [freellmPage, setFreellmPage] = useState(1);

  const statusQuery = trpc.llm.freeModelsStatus.useQuery(undefined, { staleTime: 15_000 });
  const modelsQuery = trpc.llm.listFreeModels.useQuery(
    { q: q.trim() || undefined, modality, sort },
    { staleTime: 15_000 },
  );
  const channelsQuery = trpc.llm.listFreellmChannels.useQuery(undefined, { staleTime: 15_000 });

  // 筛选变化时回到第一页，避免停在空页
  useEffect(() => {
    setOrPage(1);
  }, [q, modality, sort]);
  const refreshMutation = trpc.llm.refreshFreeModels.useMutation({
    onSuccess: async (res) => {
      setToast(
        `已刷新：OpenRouter ${res.openRouterFreeModels} · freellm 探活 ${res.validated}（新增 ${res.synced}）`,
      );
      await Promise.all([
        utils.llm.freeModelsStatus.invalidate(),
        utils.llm.listFreeModels.invalidate(),
        utils.llm.listFreellmChannels.invalidate(),
      ]);
      window.setTimeout(() => setToast(null), 4000);
    },
    onError: (err) => {
      setToast(`刷新失败：${err.message}`);
      window.setTimeout(() => setToast(null), 5000);
    },
  });

  const onCopy = async (id: string) => {
    const ok = await copyText(id);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const openRouterItems = modelsQuery.data?.items ?? [];
  const freellmItems = channelsQuery.data?.items ?? [];
  const hasOrKey = statusQuery.data?.openRouter.hasApiKey ?? modelsQuery.data?.hasApiKey;

  const orTotal = openRouterItems.length;
  const orTotalPages = Math.max(1, Math.ceil(orTotal / OPENROUTER_PAGE_SIZE));
  const orPageSafe = Math.min(orPage, orTotalPages);
  const orPageItems = useMemo(() => {
    const start = (orPageSafe - 1) * OPENROUTER_PAGE_SIZE;
    return openRouterItems.slice(start, start + OPENROUTER_PAGE_SIZE);
  }, [openRouterItems, orPageSafe]);

  const freellmTotal = freellmItems.length;
  const freellmTotalPages = Math.max(1, Math.ceil(freellmTotal / FREELLM_PAGE_SIZE));
  const freellmPageSafe = Math.min(freellmPage, freellmTotalPages);
  const freellmPageItems = useMemo(() => {
    const start = (freellmPageSafe - 1) * FREELLM_PAGE_SIZE;
    return freellmItems.slice(start, start + FREELLM_PAGE_SIZE);
  }, [freellmItems, freellmPageSafe]);

  const modalityOptions = useMemo(
    () => [
      { value: "all", label: "全部模态" },
      { value: "text", label: "纯文本" },
      { value: "multimodal", label: "多模态" },
    ],
    [],
  );
  const sortOptions = useMemo(
    () => [
      { value: "context_desc", label: "上下文 ↓" },
      { value: "context_asc", label: "上下文 ↑" },
      { value: "name", label: "名称" },
    ],
    [],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="w-full space-y-5"
    >
        {/* 顶栏：状态 + 刷新 */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-[var(--kp-divider)]",
            "bg-gradient-to-br from-[var(--kp-bg-alt)] via-[var(--kp-bg)] to-[var(--kp-brand-soft)]",
            "px-4 py-4 md:px-5 md:py-4",
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-[var(--kp-brand)]/10 blur-2xl"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusPill tone="brand">
                OpenRouter {statusQuery.data?.openRouter.count ?? openRouterItems.length}
              </StatusPill>
              <StatusPill tone="neutral">
                freellm {statusQuery.data?.freellm.credentialCount ?? freellmItems.length}
              </StatusPill>
              {hasOrKey === false && <StatusPill tone="warn">未配 OR key</StatusPill>}
              {statusQuery.data?.freellm.runtimeModel && (
                <StatusPill tone="ok">运行时 {statusQuery.data.freellm.runtimeModel}</StatusPill>
              )}
              {statusQuery.data?.openRouter.syncedAt && (
                <span className="text-[11px] text-[var(--kp-text-2)]">
                  同步于 {new Date(statusQuery.data.openRouter.syncedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {toast && (
                <span className="max-w-[16rem] truncate text-[11px] text-[var(--kp-brand-deep)] md:max-w-xs">
                  {toast}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="gap-1.5 shadow-sm"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", refreshMutation.isPending && "animate-spin")}
                />
                {refreshMutation.isPending ? "同步中…" : "立即刷新"}
              </Button>
            </div>
          </div>
        </div>

        {/* OpenRouter */}
        <section
          className={cn(
            "overflow-hidden rounded-2xl border border-[var(--kp-divider)]",
            "bg-[var(--kp-bg-alt)]/80 shadow-[0_1px_0_rgba(45,42,38,0.04),0_12px_40px_-24px_rgba(45,42,38,0.35)]",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--kp-divider)] px-4 py-3 md:px-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">OpenRouter 免费模型</h2>
                <p className="text-[11px] text-[var(--kp-text-2)]">点击模型 id 即可复制到 Chat</p>
              </div>
            </div>
            <a
              href="https://openrouter.ai/models?q=free"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-brand-soft)] hover:text-[var(--kp-brand-deep)]"
            >
              官方目录 <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="space-y-3 px-4 py-3 md:px-5">
            {!hasOrKey && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950/80 dark:text-amber-100/90">
                未配置 <code className="rounded bg-black/5 px-1 font-mono">OPENROUTER_API_KEY</code>
                。写入项目根目录 <code className="rounded bg-black/5 px-1 font-mono">.env</code>{" "}
                后重启即可在线同步 <code className="rounded bg-black/5 px-1 font-mono">:free</code>{" "}
                目录；有落盘缓存时可只读浏览。
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1 max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--kp-text-3)]" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索模型 id / 名称 / 描述…"
                  className="h-9 border-[var(--kp-divider)] bg-[var(--kp-bg)] pl-8 text-sm"
                />
              </div>
              <KpSelect
                value={modality}
                onChange={(v) => setModality(v as "all" | "text" | "multimodal")}
                options={modalityOptions}
                className="w-32"
              />
              <KpSelect
                value={sort}
                onChange={(v) => setSort(v as "context_desc" | "context_asc" | "name")}
                options={sortOptions}
                className="w-32"
              />
            </div>
          </div>

          {modelsQuery.isLoading ? (
            <div className="px-4 pb-5 md:px-5">
              <LoadingState />
            </div>
          ) : openRouterItems.length === 0 ? (
            <div className="px-4 pb-5 md:px-5">
              <EmptyState
                title="暂无 :free 模型"
                description={
                  hasOrKey
                    ? "点击「立即刷新」从 OpenRouter 拉取目录。"
                    : "配置 OPENROUTER_API_KEY 后刷新即可。"
                }
              />
            </div>
          ) : (
            <>
            <ul className="divide-y divide-[var(--kp-divider)] border-t border-[var(--kp-divider)]">
              {orPageItems.map((m, i) => {
                const text = m.description || m.topProvider || "";
                const long = text.length > 140;
                const open = !!expandedDesc[m.id];
                const multi = isMultimodal(m.modality);
                const globalIndex = (orPageSafe - 1) * OPENROUTER_PAGE_SIZE + i + 1;
                const publisher = m.id.includes("/") ? m.id.slice(0, m.id.indexOf("/")) : "—";
                return (
                  <li
                    key={m.id}
                    className={cn(
                      "group px-4 py-3.5 transition-colors md:px-5",
                      "hover:bg-[var(--kp-bg)]/70",
                      i % 2 === 1 && "bg-[var(--kp-bg)]/35",
                    )}
                  >
                    <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-[var(--kp-text-3)]">
                            #{globalIndex}
                          </span>
                          <StatusPill tone="brand">{publisher}</StatusPill>
                          <h3 className="text-sm font-semibold leading-snug text-[var(--kp-text-1)]">
                            {m.name}
                          </h3>
                          <StatusPill tone="ok">Free</StatusPill>
                          {multi && <StatusPill tone="brand">多模态</StatusPill>}
                          <StatusPill tone="neutral">{formatContext(m.contextLength)} ctx</StatusPill>
                        </div>
                        <CopyIdButton
                          id={m.id}
                          copied={copiedId === m.id}
                          onCopy={() => void onCopy(m.id)}
                        />
                        {text ? (
                          <div className="max-w-3xl space-y-1">
                            <p
                              className={cn(
                                "text-xs leading-relaxed text-[var(--kp-text-2)] whitespace-pre-wrap break-words",
                                !open && long && "line-clamp-2",
                              )}
                            >
                              {text}
                            </p>
                            {long && (
                              <button
                                type="button"
                                className="text-[11px] font-medium text-[var(--kp-brand-deep)] hover:underline"
                                onClick={() =>
                                  setExpandedDesc((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                                }
                              >
                                {open ? "收起" : "展开全部"}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end lg:pt-0.5">
                        <span className="text-[11px] text-[var(--kp-text-2)]">
                          {formatModality(m.modality)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 gap-1.5 border border-[var(--kp-divider)] bg-[var(--kp-bg)] text-[var(--kp-text-1)] hover:border-[var(--kp-brand)]/40 hover:bg-[var(--kp-brand-soft)]"
                          onClick={() => void onCopy(m.id)}
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              已复制
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              复制 id
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="px-2 md:px-3">
              <Pagination
                page={orPageSafe}
                pageSize={OPENROUTER_PAGE_SIZE}
                total={orTotal}
                totalPages={orTotalPages}
                onPageChange={setOrPage}
              />
            </div>
            </>
          )}
        </section>

        {/* Freellm */}
        <section
          className={cn(
            "overflow-hidden rounded-2xl border border-[var(--kp-divider)]",
            "bg-[var(--kp-bg-alt)]/80 shadow-[0_1px_0_rgba(45,42,38,0.04),0_12px_40px_-24px_rgba(45,42,38,0.35)]",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--kp-divider)] px-4 py-3 md:px-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <Radio className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">Freellm 网关通道</h2>
                <p className="text-[11px] text-[var(--kp-text-2)]">已探活入库 · 不展示明文 key</p>
              </div>
            </div>
          </div>

          {channelsQuery.isLoading ? (
            <div className="px-4 py-5 md:px-5">
              <LoadingState />
            </div>
          ) : freellmItems.length === 0 ? (
            <div className="px-4 py-5 md:px-5">
              <EmptyState
                title="暂无 freellm 通道"
                description="启动同步或点击「立即刷新」从 GitHub freellm / 本地 README 拉取并探活。"
              />
            </div>
          ) : (
            <>
            <ul className="divide-y divide-[var(--kp-divider)]">
              {freellmPageItems.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex flex-col gap-2 px-4 py-3.5 transition-colors md:px-5 sm:flex-row sm:items-center sm:justify-between",
                    "hover:bg-[var(--kp-bg)]/70",
                    c.isRuntime && "bg-[var(--kp-brand-soft)]/50",
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--kp-text-1)]">
                        {c.model ?? c.name}
                      </h3>
                      {c.isRuntime && <StatusPill tone="ok">运行时</StatusPill>}
                      <StatusPill tone={c.validated ? "ok" : "neutral"}>
                        {c.validated ? "已探活" : c.status ?? "—"}
                      </StatusPill>
                      {c.provider && <StatusPill tone="neutral">{c.provider}</StatusPill>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--kp-text-2)]">
                      <span className="font-mono truncate max-w-[18rem]">{c.name}</span>
                      {c.budget && <span>预算 {c.budget}</span>}
                      {c.rateLimit && <span>限速 {c.rateLimit}</span>}
                      {c.expiresAt && (
                        <span>过期 {new Date(c.expiresAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  {c.model && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 shrink-0 gap-1.5 border border-[var(--kp-divider)] bg-[var(--kp-bg)] hover:bg-[var(--kp-brand-soft)]"
                      onClick={() => void onCopy(c.model!)}
                    >
                      {copiedId === c.model ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          已复制
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          复制 id
                        </>
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-2 md:px-3">
              <Pagination
                page={freellmPageSafe}
                pageSize={FREELLM_PAGE_SIZE}
                total={freellmTotal}
                totalPages={freellmTotalPages}
                onPageChange={setFreellmPage}
              />
            </div>
            </>
          )}
        </section>
    </motion.div>
  );
}

/** Dashboard 摘要卡 */
export function FreeModelsSummaryCard() {
  const { data, isLoading } = trpc.llm.freeModelsStatus.useQuery(undefined, {
    staleTime: 30_000,
  });

  return (
    <a
      href="/free-models"
      className={cn(
        "block rounded-2xl border border-[var(--kp-divider)] p-4 md:p-5 transition-colors",
        "bg-gradient-to-br from-[var(--kp-bg-alt)] to-[var(--kp-brand-soft)]/40",
        "hover:border-[var(--kp-brand-deep)]/35",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="font-semibold text-[var(--kp-text-1)]">免费模型目录</span>
        {isLoading || !data ? (
          <span className="text-[var(--kp-text-2)]">加载中…</span>
        ) : (
          <>
            <span className="font-mono text-[var(--kp-text-2)]">
              OpenRouter {data.openRouter.count}
              {" · "}
              freellm {data.freellm.credentialCount}
            </span>
            {!data.openRouter.hasApiKey && <StatusPill tone="warn">未配 OR key</StatusPill>}
            <span className="text-[11px] font-medium text-[var(--kp-brand-deep)]">查看全部 →</span>
          </>
        )}
      </div>
    </a>
  );
}
