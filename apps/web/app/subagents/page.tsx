"use client";

/**
 * Subagent 后台管理页 — 列出所有子代理任务会话，支持状态过滤与操作
 */

import { useState } from "react";
import Link from "next/link";
import { Bot, ExternalLink, Square, Trash2, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, Pagination } from "@/components/shared";
import type { SessionStatus } from "@knowpilot/shared";

const STATUS_OPTIONS = ["", "running", "queued", "completed", "failed", "paused"] as const;
const STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  queued: "排队中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  active: "活跃",
};
const STATUS_COLOR: Record<string, string> = {
  running: "bg-blue-500",
  queued: "bg-amber-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  paused: "bg-gray-400",
  active: "bg-green-500",
};

export default function SubagentsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const query = trpc.session.list.useQuery({
    page,
    pageSize: 20,
    kind: "subagent",
    ...(status ? { status: status as SessionStatus } : {}),
  });
  // orchestrator 全局统计（排队/运行/上限），有 running/queued 时 3s 轮询
  const statsQuery = trpc.agent.asyncQueueStats.useQuery(undefined, {
    refetchInterval: (q) => {
      const s = q.state.data as { runningGlobal?: number; queued?: number } | undefined;
      return (s?.runningGlobal ?? 0) > 0 || (s?.queued ?? 0) > 0 ? 3000 : false;
    },
  });
  const stats = statsQuery.data;
  const stopMut = trpc.session.stop.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });
  const deleteMut = trpc.session.delete.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });
  const rerunMut = trpc.session.rerun.useMutation({
    onSuccess: () => utils.session.list.invalidate(),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = query.data?.totalPages ?? 1;
  const confirmTarget = items.find((s) => s.id === confirmId);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-[var(--kp-text-1)]">子代理任务</h1>
            <p className="text-xs text-[var(--kp-text-3)]">管理后台异步子代理会话</p>
          </div>
        </div>

        {stats && (
          <div data-testid="orchestrator-stats" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "排队中", value: stats.queued, color: "text-amber-600" },
              { label: "执行中", value: stats.runningGlobal, color: "text-blue-600" },
              { label: "全局上限", value: stats.maxGlobal, color: "text-[var(--kp-text-2)]" },
              { label: "每会话上限", value: stats.maxPerSession, color: "text-[var(--kp-text-2)]" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2">
                <div className={cn("text-lg font-bold tabular-nums", item.color)}>{item.value}</div>
                <div className="text-[10px] text-[var(--kp-text-3)]">{item.label}</div>
              </div>
            ))}
          </div>
        )}

      <div className="mb-4 flex items-center gap-2">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              status === s
                ? "bg-[var(--kp-brand)] text-white"
                : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]",
            )}
          >
            {s ? STATUS_LABEL[s] ?? s : "全部"}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Bot className="h-10 w-10 opacity-40" />} title="暂无子代理任务" description="在 Chat 中让 Agent 调用 run_async 即可创建子代理。" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] text-[var(--kp-text-3)]">
              <tr>
                <th className="px-3 py-2 font-medium">标题</th>
                <th className="px-3 py-2 font-medium">父会话</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">更新时间</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-[var(--kp-divider-light)] last:border-0">
                  <td className="max-w-[18rem] px-3 py-2">
                    <div className="truncate font-medium text-[var(--kp-text-1)]">{s.title}</div>
                    {s.taskDescription && (
                      <div className="mt-0.5 line-clamp-1 text-[10px] text-[var(--kp-text-3)]">{s.taskDescription}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {s.parentSessionId ? (
                      <Link
                        href={`/chat?sessionId=${s.parentSessionId}`}
                        className="text-[var(--kp-brand)] hover:underline"
                      >
                        {s.parentSessionId.slice(-6)}
                      </Link>
                    ) : (
                      <span className="text-[var(--kp-text-3)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full", STATUS_COLOR[s.status] ?? "bg-gray-400")} />
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--kp-text-3)]">
                    {new Date(s.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/chat?sessionId=${s.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 gap-1 px-2 text-[10px]")}
                      >
                        <ExternalLink className="h-3 w-3" /> 详情
                      </Link>
                      {(s.status === "running" || s.status === "queued") && (
                        <button
                          type="button"
                          onClick={() => stopMut.mutate({ id: s.id })}
                          disabled={stopMut.isPending}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 gap-1 px-2 text-[10px]")}
                        >
                          <Square className="h-3 w-3" /> 停止
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => rerunMut.mutate({ id: s.id })}
                        disabled={rerunMut.isPending}
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 gap-1 px-2 text-[10px]")}
                      >
                        <RotateCcw className="h-3 w-3" /> 重跑
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(s.id)}
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 gap-1 px-2 text-[10px] text-red-500 hover:text-red-600")}
                      >
                        <Trash2 className="h-3 w-3" /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination page={page} pageSize={20} total={total} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmId}
        title="删除子代理"
        description={`确定删除「${confirmTarget?.title ?? ""}」？删除后无法恢复。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          if (confirmId) deleteMut.mutate({ id: confirmId });
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
      </div>
    </div>
  );
}
