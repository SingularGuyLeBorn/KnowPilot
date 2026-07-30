"use client";
/**
 * 待你点头 — 高风险动作人类审批队列
 * 承诺：人不在场 → 请求挂着，绝不擅自执行；超时只拒绝不执行。
 */


import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Check, X, Play, Clock, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Approval } from "@knowpilot/shared";
import { useApproval } from "@/lib/hooks";
import { useCardDensity } from "@/lib/useCardDensity";
import { EmptyState, LoadingState, Pagination, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import { UI_STATE_CHANNEL } from "@/lib/uiStateChannel";

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "executed";

const STATUS_LABELS: Record<string, string> = {
  pending: "待你点头",
  approved: "已通过",
  rejected: "已拒绝",
  executed: "已执行",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "kp-badge-warning",
  approved: "kp-badge-success",
  rejected: "kp-badge-danger",
  executed: "kp-badge-info",
};

function formatTtlRemaining(createdAt: Date | string, ttlMs: number): string | null {
  if (ttlMs <= 0) return "不会自动过期（仍不会自动执行）";
  const expiresAt = new Date(createdAt).getTime() + ttlMs;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "即将按超时拒绝";
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  if (h >= 1) return `${h} 小时 ${m} 分后超时拒绝`;
  return `${m} 分钟后超时拒绝`;
}

export default function ApprovalsPage() {
  const {
    useList,
    useUpdate,
    useExecute,
    useApproveAndExecute,
    useApproveAndExecuteBatch,
    useRejectBatch,
    useHumanTodoSummary,
  } = useApproval();
  const { density } = useCardDensity();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const listInput = {
    page,
    pageSize: 10,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  };
  // 推拉：PUSH=approval_updated SSE/BC；PULL=有 pending 时 3s，否则 15s
  const { data, isLoading } = useList(listInput, {
    refetchInterval: (q: { state: { data?: { items?: Approval[] } } }) => {
      const items = q.state.data?.items ?? [];
      const pending = items.some((a) => a.status === "pending");
      return pending || statusFilter === "pending" ? 3000 : 15_000;
    },
  });
  const { data: summary } = useHumanTodoSummary({ refetchInterval: 5000 });
  const utils = trpc.useUtils();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let bc: BroadcastChannel;
    try {
      bc = new BroadcastChannel(UI_STATE_CHANNEL);
    } catch {
      return;
    }
    const onMsg = (ev: MessageEvent) => {
      if ((ev.data as { type?: string } | null)?.type !== "approval_updated") return;
      utils.approval.list.invalidate().catch(catchUnlessCancelled("app/approvals/page.tsx"));
      utils.approval.humanTodoSummary.invalidate().catch(catchUnlessCancelled("app/approvals/page.tsx"));
    };
    bc.addEventListener("message", onMsg);
    return () => {
      bc.removeEventListener("message", onMsg);
      bc.close();
    };
  }, [utils]);
  const updateMutation = useUpdate();
  const approveExecuteMutation = useApproveAndExecute();
  const executeMutation = useExecute();
  const batchApprove = useApproveAndExecuteBatch();
  const batchReject = useRejectBatch();

  const pendingIdsOnPage = useMemo(
    () => (data?.items ?? []).filter((a: Approval) => a.status === "pending").map((a: Approval) => a.id),
    [data?.items],
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllPending = () => {
    setSelected((prev) => {
      if (pendingIdsOnPage.every((id: string) => prev.has(id))) return new Set();
      return new Set(pendingIdsOnPage);
    });
  };

  const handleReject = (id: string) => {
    updateMutation.mutate({ id, status: "rejected" });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleApproveOnly = (id: string) => {
    updateMutation.mutate({ id, status: "approved" });
  };

  const handleApproveAndExecute = (id: string) => {
    approveExecuteMutation.mutate({ id });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const selectedList = [...selected];
  const busy =
    updateMutation.isPending ||
    approveExecuteMutation.isPending ||
    batchApprove.isPending ||
    batchReject.isPending;

  const formatArgs = (args: unknown) => {
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="待你点头"
        description="高风险动作（删除、Git 写入、Skill 上线等）会挂在这里。人不在场绝不擅自执行；超时只会拒绝，不会执行。"
        showDensityToggle
      />

      {summary && (
        <div
          className="rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-soft)] px-4 py-3 text-sm text-[var(--kp-text-2)]"
          data-testid="approval-human-todo-summary"
        >
          <span className="font-medium text-[var(--kp-text-1)]">
            {summary.pendingCount} 条待你点头
          </span>
          <span className="mx-2 text-[var(--kp-text-3)]">·</span>
          <span>{summary.hint}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          {(["pending", "approved", "rejected", "executed", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
                setSelected(new Set());
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                statusFilter === s
                  ? "bg-[var(--kp-brand-deep)] text-white shadow-sm"
                  : "bg-[var(--kp-bg-soft)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
              )}
            >
              {s === "all" ? "全部" : STATUS_LABELS[s]}
              {s === "pending" && summary?.pendingCount
                ? ` (${summary.pendingCount})`
                : ""}
            </button>
          ))}
        </div>

        {statusFilter === "pending" && pendingIdsOnPage.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={toggleAllPending} disabled={busy}>
              <CheckCheck className="w-3.5 h-3.5" />
              {pendingIdsOnPage.every((id: string) => selected.has(id)) ? "取消全选" : "全选本页"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              disabled={busy || selectedList.length === 0}
              onClick={() =>
                batchReject.mutate(
                  { ids: selectedList },
                  { onSuccess: () => setSelected(new Set()) },
                )
              }
            >
              <X className="w-3.5 h-3.5" />
              批量拒绝{selectedList.length ? ` (${selectedList.length})` : ""}
            </Button>
            <Button
              size="sm"
              className="bg-[var(--kp-brand-deep)] text-white"
              disabled={busy || selectedList.length === 0}
              onClick={() =>
                batchApprove.mutate(
                  { ids: selectedList },
                  { onSuccess: () => setSelected(new Set()) },
                )
              }
              data-testid="approval-batch-approve-execute"
            >
              <Play className="w-3.5 h-3.5" />
              批量批准并执行{selectedList.length ? ` (${selectedList.length})` : ""}
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title={statusFilter === "pending" ? "暂无待你点头的事项" : "没有匹配的审批记录"}
          description="危险操作被拦截时会出现在此。挂起期间 Agent 不会跳过执行。"
        />
      ) : (
        <>
          <div className="space-y-4">
            {data.items.map((approval: Approval, idx: number) => (
              <motion.div
                key={approval.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.03, type: "spring", stiffness: 200, damping: 20 },
                }}
                className={cn(
                  "kp-card-premium kp-lift rounded-2xl",
                  density === "compact" ? "p-3" : "p-5",
                  selected.has(approval.id) && "ring-2 ring-[var(--kp-brand-deep)]/40",
                )}
                data-testid="approval-card"
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {approval.status === "pending" && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--kp-brand-deep)]"
                          checked={selected.has(approval.id)}
                          onChange={() => toggleOne(approval.id)}
                          aria-label={`选择 ${approval.toolName}`}
                        />
                      )}
                      <code className="rounded-lg bg-[var(--kp-bg-mute)] px-2 py-1 text-sm font-bold text-[var(--kp-text-1)]">
                        {approval.toolName}
                      </code>
                      <span className={cn("kp-badge", STATUS_BADGE[approval.status] ?? "kp-badge-warning")}>
                        {STATUS_LABELS[approval.status] ?? approval.status}
                      </span>
                      {approval.decisionScope ? (
                        <code
                          className="kp-badge"
                          style={{ background: "var(--kp-bg-mute)", color: "var(--kp-text-2)" }}
                          title="decisionScope（调度面相交检查）"
                          data-testid="approval-decision-scope"
                        >
                          {approval.decisionScope}
                        </code>
                      ) : null}
                    </div>
                    <pre className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-3 text-[11px] font-mono overflow-x-auto max-h-32 text-[var(--kp-text-2)] shadow-inner">
                      {formatArgs(approval.args)}
                    </pre>
                    <p className="text-[11px] text-[var(--kp-text-3)] flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(approval.createdAt).toLocaleString("zh-CN")}
                      </span>
                      {approval.status === "pending" && summary && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {formatTtlRemaining(approval.createdAt, summary.ttlMs)}
                        </span>
                      )}
                    </p>
                  </div>

                  {approval.status === "pending" && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleReject(approval.id)}
                        disabled={busy}
                      >
                        <X className="w-3.5 h-3.5" />
                        拒绝
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => handleApproveOnly(approval.id)}
                        disabled={busy}
                      >
                        <Check className="w-3.5 h-3.5" />
                        仅批准
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1 bg-[var(--kp-brand-deep)] text-white hover:bg-[var(--kp-brand-deep)]"
                        onClick={() => handleApproveAndExecute(approval.id)}
                        disabled={busy}
                        data-testid="approval-approve-execute"
                      >
                        <Play className="w-3.5 h-3.5" />
                        批准并执行
                      </Button>
                    </div>
                  )}

                  {approval.status === "approved" && approval.toolName !== "workflow.step" && (
                    <Button
                      size="sm"
                      className="gap-1 shrink-0"
                      onClick={() => executeMutation.mutate({ id: approval.id })}
                      disabled={executeMutation.isPending}
                    >
                      <Play className="w-3.5 h-3.5" />
                      执行
                    </Button>
                  )}
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
    </div>
  );
}
