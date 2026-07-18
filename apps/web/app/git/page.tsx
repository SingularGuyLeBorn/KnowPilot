/**
 * Git 仓库工作台 — 关联本项目仓库 + status / diff / log + commit/pull/push（写操作走审批）
 */

"use client";

import React, { useCallback, useState } from "react";
import { motion } from "framer-motion";
import {
  GitBranch,
  Plus,
  GitCommit,
  RefreshCw,
  Upload,
  Download,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import type { GitRepo } from "@knowpilot/shared";
import { useGit, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

function extractApprovalHint(message: string | undefined): string | null {
  if (!message) return null;
  if (message.includes("需要人工审批") || message.includes("/approvals")) {
    return message;
  }
  return null;
}

export default function GitPage() {
  const {
    useList,
    useCreate,
    useDelete,
    useStatus,
    useLog,
    useDiff,
    useCommit,
    usePull,
    usePush,
  } = useGit();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [banner, setBanner] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);

  const { data, isLoading, refetch } = useList({ page, pageSize: 12 });
  const createMutation = useCreate({
    onSuccess: (res: { success?: boolean; error?: { message?: string } }) => {
      if (res?.success === false) {
        setBanner({ type: "err", text: res.error?.message || "关联失败" });
        return;
      }
      setBanner({ type: "ok", text: "已关联本项目仓库（path: .）" });
      void refetch();
    },
    onError: (err: { message?: string }) => {
      setBanner({ type: "err", text: err.message || "关联失败" });
    },
  });
  const deleteMutation = useDelete();

  const selected = data?.items.find((r: GitRepo) => r.id === selectedId) ?? data?.items[0];
  const activeId = selected?.id;

  const statusQuery = useStatus({ repoId: activeId }, { enabled: !!activeId });
  const logQuery = useLog({ repoId: activeId, limit: 12 }, { enabled: !!activeId });
  const diffQuery = useDiff({ repoId: activeId, staged: false }, { enabled: !!activeId });

  const refreshAll = useCallback(() => {
    void statusQuery.refetch();
    void logQuery.refetch();
    void diffQuery.refetch();
    void refetch();
  }, [statusQuery, logQuery, diffQuery, refetch]);

  const commitMutation = useCommit({
    onSuccess: () => {
      setBanner({ type: "ok", text: "提交成功" });
      setCommitMessage("");
      refreshAll();
    },
    onError: (err) => {
      const hint = extractApprovalHint(err.message);
      setBanner({
        type: hint ? "info" : "err",
        text: hint || err.message || "提交失败",
      });
    },
  });
  const pullMutation = usePull({
    onSuccess: () => {
      setBanner({ type: "ok", text: "Pull 成功" });
      refreshAll();
    },
    onError: (err) => {
      const hint = extractApprovalHint(err.message);
      setBanner({
        type: hint ? "info" : "err",
        text: hint || err.message || "Pull 失败",
      });
    },
  });
  const pushMutation = usePush({
    onSuccess: () => {
      setBanner({ type: "ok", text: "Push 成功" });
      refreshAll();
    },
    onError: (err) => {
      const hint = extractApprovalHint(err.message);
      setBanner({
        type: hint ? "info" : "err",
        text: hint || err.message || "Push 失败",
      });
    },
  });

  const handleLinkProject = () => {
    const existing = data?.items?.find((r: GitRepo) => r.path === "." || r.path === "./");
    if (existing) {
      setSelectedId(existing.id);
      setBanner({ type: "info", text: "本项目仓库已关联，已选中" });
      return;
    }
    createMutation.mutate({
      name: "KnowPilot",
      path: ".",
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

  const busy =
    commitMutation.isPending || pullMutation.isPending || pushMutation.isPending;

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={GitBranch}
        title="Git 仓库"
        description="关联本项目仓库后可查看 status / diff / 提交历史，并经审批执行 commit / pull / push。"
        action={{
          label: "关联本项目仓库",
          onClick: handleLinkProject,
          icon: Plus,
        }}
        showDensityToggle
      />

      {banner && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
            banner.type === "ok" &&
              "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
            banner.type === "err" &&
              "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
            banner.type === "info" &&
              "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
          )}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="break-words whitespace-pre-wrap">{banner.text}</p>
            {banner.type === "info" && banner.text.includes("/approvals") && (
              <Link
                href="/approvals"
                className="inline-flex font-medium underline underline-offset-2"
              >
                前往审批页批准并执行
              </Link>
            )}
          </div>
          <button
            type="button"
            className="text-xs opacity-70 hover:opacity-100"
            onClick={() => setBanner(null)}
          >
            关闭
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="未关联版本控制"
          description="点击「关联本项目仓库」注册 path 为「.」的相对路径（相对项目根，非绝对磁盘路径）。关联后可查看改动、diff，并经审批提交。"
          actionLabel="关联本项目仓库"
          onAction={handleLinkProject}
        />
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] ",
              density === "compact" ? "gap-4" : "gap-6",
            )}
          >
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
                    ? "border-[var(--kp-brand-deep)] bg-white shadow-lg dark:bg-[var(--kp-bg-soft)]"
                    : "border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] hover:shadow-md",
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[var(--kp-brand-deep)]" />
                  <h3 className="text-sm font-bold text-[var(--kp-text-1)]">{repo.name}</h3>
                </div>
                <code className="block truncate text-[10px] text-[var(--kp-text-3)]">{repo.path}</code>
                <span className="mt-2 inline-flex items-center gap-1 rounded bg-[var(--kp-bg-soft)] px-2 py-0.5 font-mono text-xs">
                  <GitCommit className="h-3 w-3" />
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
              className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--kp-text-1)]">
                  {selected.name} · 工作台
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/git/edit/${selected.id}`}
                    className="inline-flex items-center rounded-lg border border-[var(--kp-divider)] px-2 py-1 text-[10px] text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                  >
                    编辑
                  </Link>
                  <button
                    type="button"
                    onClick={refreshAll}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--kp-divider)] px-2 py-1 text-[10px] hover:bg-[var(--kp-bg-soft)]"
                  >
                    <RefreshCw className="h-3 w-3" />
                    刷新
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-[var(--kp-text-3)]">
                    提交信息
                  </span>
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="例如：更新文章与 Agent 配置"
                    className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand-deep)]"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !commitMessage.trim()}
                    onClick={() =>
                      commitMutation.mutate({
                        repoId: selected.id,
                        message: commitMessage.trim(),
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--kp-brand-deep)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                  >
                    <GitCommit className="h-3.5 w-3.5" />
                    Commit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pullMutation.mutate({ repoId: selected.id })}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--kp-divider)] px-3 py-2 text-xs hover:bg-[var(--kp-bg-soft)] disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Pull
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pushMutation.mutate({ repoId: selected.id })}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--kp-divider)] px-3 py-2 text-xs hover:bg-[var(--kp-bg-soft)] disabled:opacity-40"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Push
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[var(--kp-text-3)]">
                Commit / Pull / Push 默认需人工审批：首次点击会创建审批单，请到{" "}
                <Link href="/approvals" className="underline underline-offset-2">
                  /approvals
                </Link>{" "}
                批准并执行。
              </p>

              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-[var(--kp-text-3)]">
                  工作区状态
                </div>
                {statusQuery.isLoading ? (
                  <p className="text-xs text-[var(--kp-text-3)]">加载中…</p>
                ) : statusQuery.error ? (
                  <p className="text-xs text-red-600">{statusQuery.error.message}</p>
                ) : (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] p-3 font-mono text-[10px] text-[var(--kp-text-2)]">
                    {(statusQuery.data as { status?: string })?.status || "（干净工作区）"}
                  </pre>
                )}
              </div>

              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-[var(--kp-text-3)]">
                  Diff（未暂存，最多约 12KB）
                </div>
                {diffQuery.isLoading ? (
                  <p className="text-xs text-[var(--kp-text-3)]">加载中…</p>
                ) : diffQuery.error ? (
                  <p className="text-xs text-red-600">{diffQuery.error.message}</p>
                ) : (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] p-3 font-mono text-[10px] text-[var(--kp-text-2)]">
                    {(diffQuery.data as { diff?: string })?.diff || "（无 diff）"}
                  </pre>
                )}
              </div>

              <div>
                <div className="mb-1 text-[10px] font-bold uppercase text-[var(--kp-text-3)]">
                  最近提交
                </div>
                {logQuery.isLoading ? (
                  <p className="text-xs text-[var(--kp-text-3)]">加载中…</p>
                ) : logQuery.error ? (
                  <p className="text-xs text-red-600">{logQuery.error.message}</p>
                ) : (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] p-3 font-mono text-[10px] text-[var(--kp-text-2)]">
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
