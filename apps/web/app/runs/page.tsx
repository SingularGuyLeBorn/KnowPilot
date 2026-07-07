/**
 * Runs Agent 执行记录页面 (L2 运行时)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Activity, Sparkles, Clock, Bot } from "lucide-react";
import Link from "next/link";
import type { Run } from "@knowpilot/shared";
import { useRun } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination } from "@/components/shared";
import { formatRelativeTime } from "@/lib/utils";

const STATUS_STYLE: Record<Run["status"], string> = {
  pending: "bg-yellow-500/10 text-yellow-600",
  running: "bg-blue-500/10 text-blue-500 animate-pulse",
  success: "bg-green-500/10 text-green-600",
  failed: "bg-red-500/10 text-red-600",
  cancelled: "bg-gray-500/10 text-gray-500",
};

const STATUS_LABEL: Record<Run["status"], string> = {
  pending: "等待中",
  running: "运行中",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
};

export default function RunsPage() {
  const { useList, useDelete } = useRun();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, isLoading } = useList({
    page,
    pageSize: 20,
    status: statusFilter || undefined,
  });
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-[var(--vp-c-divider)] bg-gradient-to-br from-[var(--vp-c-bg-alt)] to-[var(--vp-c-bg-soft)] p-8 shadow-sm"
      >
        <div className="absolute right-0 top-0 -translate-y-12 translate-x-12 opacity-5 blur-2xl">
          <Activity className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
            <Sparkles className="w-3.5 h-3.5" />
            L2 · Agent 执行追踪
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
            Runs 执行记录
          </h1>
          <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
            查看 Agent 对话与工作流的每次执行状态、耗时与 Token 消耗，便于调试与审计。
          </p>
        </div>
      </motion.div>

      <div className="flex flex-wrap gap-2">
        {["", "success", "failed", "running", "pending"].map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              statusFilter === s
                ? "bg-[var(--vp-c-brand)] text-white"
                : "bg-[var(--vp-c-bg-soft)] text-[var(--vp-c-text-2)] hover:bg-[var(--vp-c-brand-soft)]"
            }`}
          >
            {s === "" ? "全部" : STATUS_LABEL[s as Run["status"]]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState count={4} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="暂无执行记录"
          description="Agent 完成一次 chat 或 workflow 后，执行记录会出现在此列表。"
        />
      ) : (
        <>
          <div className="rounded-2xl border border-[var(--vp-c-divider-light)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--vp-c-bg-soft)] text-left text-xs text-[var(--vp-c-text-3)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">Agent / Session</th>
                    <th className="px-4 py-3 font-semibold">耗时</th>
                    <th className="px-4 py-3 font-semibold">时间</th>
                    <th className="px-4 py-3 font-semibold w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--vp-c-divider-light)]">
                  {data.items.map((run: Run) => (
                    <tr key={run.id} className="hover:bg-[var(--vp-c-bg-soft)]/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[run.status]}`}>
                          {STATUS_LABEL[run.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-[var(--vp-c-text-2)]">
                          <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--vp-c-brand)]" />
                          <span className="font-mono text-xs truncate max-w-[200px]">
                            {run.agentId?.slice(0, 8) ?? "—"} / {run.sessionId?.slice(0, 8) ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--vp-c-text-3)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {run.durationMs != null ? `${run.durationMs} ms` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--vp-c-text-3)]">
                        {formatRelativeTime(run.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/runs/edit/${run.id}`}
                            className="text-xs text-[var(--vp-c-brand)] hover:text-[var(--vp-c-brand-dark)]"
                          >
                            详情
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleteId(run.id)}
                            className="text-xs text-red-500 hover:text-red-600"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
        title="删除执行记录"
        description="确定删除这条 Run 记录吗？不会影响实际 Chat 会话内容。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
