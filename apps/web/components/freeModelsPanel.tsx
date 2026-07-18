"use client";

import React, { useMemo, useState } from "react";
import { Copy, ExternalLink, RefreshCw, Sparkles, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingState, KpSelect } from "@/components/shared";
import { cn } from "@/lib/utils";

function formatContext(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatPrice(raw?: string): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return "Free";
  if (n < 0.000001) return raw;
  return `$${n.toFixed(6)}`;
}

function isMultimodal(modality?: string): boolean {
  if (!modality) return false;
  return modality !== "text" && modality !== "text->text";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function FreeModelsPanel() {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [modality, setModality] = useState<"all" | "text" | "multimodal">("all");
  const [sort, setSort] = useState<"context_desc" | "context_asc" | "name">("context_desc");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const statusQuery = trpc.llm.freeModelsStatus.useQuery(undefined, { staleTime: 15_000 });
  const modelsQuery = trpc.llm.listFreeModels.useQuery(
    { q: q.trim() || undefined, modality, sort },
    { staleTime: 15_000 },
  );
  const channelsQuery = trpc.llm.listFreellmChannels.useQuery(undefined, { staleTime: 15_000 });
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshMutation.isPending && "animate-spin")} />
          {refreshMutation.isPending ? "同步中…" : "立即刷新"}
        </Button>
        {statusQuery.data && (
          <p className="text-xs text-[var(--kp-text-3)]">
            OpenRouter {statusQuery.data.openRouter.count} 个
            {statusQuery.data.openRouter.syncedAt
              ? ` · 同步于 ${new Date(statusQuery.data.openRouter.syncedAt).toLocaleString()}`
              : " · 尚未同步"}
            {" · "}
            freellm {statusQuery.data.freellm.credentialCount} 条通道
            {statusQuery.data.freellm.runtimeModel
              ? ` · 运行时 ${statusQuery.data.freellm.runtimeModel}`
              : ""}
          </p>
        )}
        {toast && (
          <span className="text-xs text-[var(--kp-brand-deep)]">{toast}</span>
        )}
      </div>

      {/* OpenRouter */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--kp-brand-deep)]" />
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">OpenRouter 免费模型</h2>
          <a
            href="https://openrouter.ai/models?q=free"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[var(--kp-text-3)] hover:text-[var(--kp-brand-deep)]"
          >
            官方目录 <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {!hasOrKey && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-[var(--kp-text-2)]">
            未配置 <code className="font-mono">OPENROUTER_API_KEY</code>。在项目根目录{" "}
            <code className="font-mono">.env</code> 写入后重启，即可在线同步完整{" "}
            <code className="font-mono">:free</code> 目录；若有历史落盘缓存仍可只读浏览。
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模型 id / 名称 / 描述…"
            className="max-w-sm h-9 text-sm"
          />
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

        {modelsQuery.isLoading ? (
          <LoadingState />
        ) : openRouterItems.length === 0 ? (
          <EmptyState
            title="暂无 :free 模型"
            description={
              hasOrKey
                ? "点击「立即刷新」从 OpenRouter 拉取目录。"
                : "配置 OPENROUTER_API_KEY 后刷新即可。"
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--kp-divider)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--kp-bg-alt)] text-[var(--kp-text-3)]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">模型</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">上下文</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">输入</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">输出</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">模态</th>
                  <th className="px-3 py-2.5 font-medium">说明</th>
                  <th className="px-3 py-2.5 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {openRouterItems.map((m) => (
                  <tr
                    key={m.id}
                    className="border-t border-[var(--kp-divider)] hover:bg-[var(--kp-bg-alt)]/60"
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-[var(--kp-text-1)]">{m.name}</div>
                      <div className="font-mono text-[10px] text-[var(--kp-text-3)] break-all">
                        {m.id}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-[var(--kp-text-2)]">
                      {formatContext(m.contextLength)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {formatPrice(m.pricingPrompt)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {formatPrice(m.pricingCompletion)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {m.modality ?? "—"}
                      {isMultimodal(m.modality) && (
                        <span className="ml-1 text-[10px] text-[var(--kp-brand-deep)]">多模态</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-3)] max-w-xs">
                      <p className="line-clamp-2">{m.description || m.topProvider || "—"}</p>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 gap-1"
                        onClick={() => void onCopy(m.id)}
                      >
                        <Copy className="h-3 w-3" />
                        {copiedId === m.id ? "已复制" : "复制"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Freellm */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-[var(--kp-brand-deep)]" />
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">Freellm 网关通道</h2>
          <span className="text-[10px] text-[var(--kp-text-3)]">
            已探活入库 · 不展示明文 key
          </span>
        </div>

        {channelsQuery.isLoading ? (
          <LoadingState />
        ) : freellmItems.length === 0 ? (
          <EmptyState
            title="暂无 freellm 通道"
            description="启动同步或点击「立即刷新」从 GitHub freellm / 本地 README 拉取并探活。"
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--kp-divider)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--kp-bg-alt)] text-[var(--kp-text-3)]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">模型</th>
                  <th className="px-3 py-2.5 font-medium">Provider</th>
                  <th className="px-3 py-2.5 font-medium">预算</th>
                  <th className="px-3 py-2.5 font-medium">限速</th>
                  <th className="px-3 py-2.5 font-medium">过期</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {freellmItems.map((c) => (
                  <tr
                    key={c.id}
                    className={cn(
                      "border-t border-[var(--kp-divider)]",
                      c.isRuntime && "bg-[var(--kp-brand-soft)]/40",
                    )}
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-[var(--kp-text-1)]">
                        {c.model ?? c.name}
                        {c.isRuntime && (
                          <span className="ml-1.5 text-[10px] font-normal text-[var(--kp-brand-deep)]">
                            运行时
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--kp-text-3)] truncate max-w-[220px]">
                        {c.name}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {c.provider ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {c.budget ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {c.rateLimit ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-3)] whitespace-nowrap">
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[var(--kp-text-2)]">
                      {c.validated ? "已探活" : c.status ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {c.model && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 gap-1"
                          onClick={() => void onCopy(c.model!)}
                        >
                          <Copy className="h-3 w-3" />
                          {copiedId === c.model ? "已复制" : "复制"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
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
      className="block rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-4 md:p-5 hover:border-[var(--kp-brand-deep)]/40 transition-colors"
    >
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Sparkles className="h-4 w-4 text-[var(--kp-brand-deep)]" />
        <span className="font-semibold text-[var(--kp-text-1)]">免费模型目录</span>
        {isLoading || !data ? (
          <span className="text-[var(--kp-text-3)]">加载中…</span>
        ) : (
          <>
            <span className="font-mono text-[var(--kp-text-2)]">
              OpenRouter {data.openRouter.count}
              {" · "}
              freellm {data.freellm.credentialCount}
            </span>
            {!data.openRouter.hasApiKey && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">未配 OR key</span>
            )}
            <span className="text-[10px] text-[var(--kp-text-3)]">查看全部 →</span>
          </>
        )}
      </div>
    </a>
  );
}
