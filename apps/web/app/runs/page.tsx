/**
 * Runs Agent 执行记录页面 (L2 运行时)
 */

"use client";

import React, { useMemo, useState } from "react";
import { Activity, Clock, Bot } from "lucide-react";
import Link from "next/link";
import type { Run } from "@knowpilot/shared";
import { useRun, useAgent } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination, PageHeader } from "@/components/shared";
import { formatRelativeTime } from "@/lib/utils";
import { agentLabel, runLabel, sessionLabel } from "@/lib/displayLabels";
import { trpc } from "@/lib/trpc";

const STATUS_STYLE: Record<Run["status"], string> = {
  pending: "bg-yellow-500/10 text-yellow-600",
  running: "bg-blue-500/10 text-blue-500 animate-pulse",
  success: "bg-green-500/10 text-green-600",
  failed: "bg-red-500/10 text-red-600",
  cancelled: "bg-gray-500/10 text-gray-500",
  interrupted: "bg-orange-500/10 text-orange-600",
};

const STATUS_LABEL: Record<Run["status"], string> = {
  pending: "等待中",
  running: "运行中",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

export default function RunsPage() {
  const { useList, useDelete } = useRun();
  const { useList: useAgentList } = useAgent();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, isLoading } = useList({
    page,
    pageSize: 20,
    status: statusFilter || undefined,
  });
  const agentsQuery = useAgentList({ page: 1, pageSize: 100 });
  const sessionsQuery = trpc.session.list.useQuery({ page: 1, pageSize: 100 });
  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agentsQuery.data?.items ?? []) {
      m.set(a.id, agentLabel(a));
    }
    return m;
  }, [agentsQuery.data?.items]);
  const sessionLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sessionsQuery.data?.items ?? []) {
      m.set(s.id, sessionLabel(s));
    }
    return m;
  }, [sessionsQuery.data?.items]);
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={Activity}
        title="Runs 执行记录"
        description="查看 Agent 对话与工作流的每次执行状态、耗时与 Token 消耗，便于调试与审计。"
      />

      <div className="flex flex-wrap gap-2">
        {["", "success", "failed", "running", "interrupted", "pending", "cancelled"].map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              statusFilter === s
                ? "bg-[var(--kp-brand-deep)] text-white"
                : "bg-[var(--kp-bg-soft)] text-[var(--kp-text-2)] hover:bg-[var(--kp-brand-soft)]"
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
          <div className="rounded-2xl border border-[var(--kp-divider-light)] overflow-hidden">
            <div className="kp-table-scroll overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-[var(--kp-bg-soft)] text-left text-xs text-[var(--kp-text-3)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">Agent / Session</th>
                    <th className="px-4 py-3 font-semibold">耗时</th>
                    <th className="px-4 py-3 font-semibold">时间</th>
                    <th className="px-4 py-3 font-semibold w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--kp-divider-light)]">
                  {data.items.map((run: Run) => (
                    <tr key={run.id} className="hover:bg-[var(--kp-bg-soft)]/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[run.status]}`}>
                          {STATUS_LABEL[run.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-[var(--kp-text-2)]">
                          <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
                          <span className="text-xs truncate max-w-[240px]" title={runLabel({
                            agentName: run.agentId ? agentNameById.get(run.agentId) : null,
                            sessionLabel: run.sessionId ? sessionLabelById.get(run.sessionId) : null,
                            status: STATUS_LABEL[run.status],
                          })}>
                            {runLabel({
                              agentName: run.agentId ? agentNameById.get(run.agentId) : null,
                              sessionLabel: run.sessionId ? sessionLabelById.get(run.sessionId) : null,
                              status: STATUS_LABEL[run.status],
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--kp-text-3)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {run.durationMs != null ? `${run.durationMs} ms` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--kp-text-3)]">
                        {formatRelativeTime(run.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/runs/edit/${run.id}`}
                            className="text-xs text-[var(--kp-brand-deep)] hover:text-[var(--kp-brand-deep)]"
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
