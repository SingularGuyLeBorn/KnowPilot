/**
 * Git 仓库版本管理页面 (L3) — CRUD + status / log
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, Plus, GitCommit, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { GitRepo } from "@knowpilot/shared";
import { useGit, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

export default function GitPage() {
  const { useList, useCreate, useDelete, useStatus, useLog } = useGit();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, refetch } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const selected = data?.items.find((r: GitRepo) => r.id === selectedId) ?? data?.items[0];
  const activeId = selected?.id;

  const statusQuery = useStatus({ repoId: activeId }, { enabled: !!activeId });
  const logQuery = useLog({ repoId: activeId, limit: 8 }, { enabled: !!activeId });

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: "KnowPilot 主仓库",
      path: "D:\\ALL IN AI\\KnowPilot",
      branch: "main",
    });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      if (selectedId === deleteId) setSelectedId(null);
      setDeleteId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={GitBranch}
        title="Git 仓库"
        description="注册本地仓库后，可查看工作区状态与最近提交历史（只读）。"
        action={{ label: "关联本地仓库", onClick: handleCreateDemo, icon: Plus }}
        showDensityToggle
      />

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="未关联版本控制"
          description="注册本地 Git 仓库后即可查看 status / log。"
          actionLabel="关联仓库"
          onAction={handleCreateDemo}
        />
      ) : (
        <>
          <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 ", density === "compact" ? "gap-4" : "gap-6")}>
            {data.items.map((repo: GitRepo, idx: number) => (
              <motion.button
                key={repo.id}
                type="button"
                onClick={() => setSelectedId(repo.id)}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.05 } }}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all",
                  activeId === repo.id
                    ? "border-[var(--vp-c-brand)] bg-white shadow-lg dark:bg-[var(--vp-c-bg-soft)]"
                    : "border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 hover:shadow-md",
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <GitBranch className="w-4 h-4 text-[var(--vp-c-brand)]" />
                  <h3 className="font-bold text-sm text-[var(--vp-c-text-1)]">{repo.name}</h3>
                </div>
                <code className="block truncate text-[10px] text-[var(--vp-c-text-3)]">{repo.path}</code>
                <span className="mt-2 inline-flex items-center gap-1 rounded bg-[var(--vp-c-bg-soft)] px-2 py-0.5 text-xs font-mono">
                  <GitCommit className="w-3 h-3" />
                  {repo.branch}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteId(repo.id);
                  }}
                  className="absolute right-3 top-3 text-[10px] text-red-500 opacity-0 group-hover:opacity-100"
                >
                  解除
                </button>
              </motion.button>
            ))}
          </div>

          {selected && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg-alt)] p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--vp-c-text-1)]">{selected.name} · 详情</h2>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/git/edit/${selected.id}`}
                    className="inline-flex items-center rounded-lg border border-[var(--vp-c-divider)] px-2 py-1 text-[10px] hover:bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]"
                  >
                    编辑
                  </Link>
                  <button
                  type="button"
                  onClick={() => {
                    void statusQuery.refetch();
                    void logQuery.refetch();
                    void refetch();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--vp-c-divider)] px-2 py-1 text-[10px] hover:bg-[var(--vp-c-bg-soft)]"
                >
                  <RefreshCw className="h-3 w-3" />
                  刷新
                </button>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-[var(--vp-c-text-3)]">工作区状态</div>
                {statusQuery.isLoading ? (
                  <p className="text-xs text-[var(--vp-c-text-3)]">加载中…</p>
                ) : statusQuery.error ? (
                  <p className="text-xs text-red-600">{statusQuery.error.message}</p>
                ) : (
                  <pre className="max-h-40 overflow-auto rounded-lg bg-[var(--vp-c-bg-mute)] p-3 text-[10px] font-mono whitespace-pre-wrap text-[var(--vp-c-text-2)]">
                    {(statusQuery.data as { status?: string })?.status || "（干净工作区）"}
                  </pre>
                )}
              </div>

              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-[var(--vp-c-text-3)]">最近提交</div>
                {logQuery.isLoading ? (
                  <p className="text-xs text-[var(--vp-c-text-3)]">加载中…</p>
                ) : logQuery.error ? (
                  <p className="text-xs text-red-600">{logQuery.error.message}</p>
                ) : (
                  <pre className="max-h-48 overflow-auto rounded-lg bg-[var(--vp-c-bg-mute)] p-3 text-[10px] font-mono whitespace-pre-wrap text-[var(--vp-c-text-2)]">
                    {((logQuery.data as { log?: string[] })?.log ?? []).join("\n") || "（无提交）"}
                  </pre>
                )}
              </div>
            </motion.div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="解除仓库版本关联"
        description="仅解除系统绑定，不会删除本地 Git 历史。"
        isDestructive
        confirmLabel="确认解除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
