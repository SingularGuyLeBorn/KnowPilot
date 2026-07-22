/**
 * Approvals 危险操作审批队列 (L4)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Check, X, Play, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Approval } from "@knowpilot/shared";
import { useApproval, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, Pagination, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "executed";

const STATUS_LABELS: Record<string, string> = {
  pending: "待审批",
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

export default function ApprovalsPage() {
  const { useList, useUpdate, useExecute, useApproveAndExecute } = useApproval();
  const { density } = useCardDensity();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const listInput = {
    page,
    pageSize: 10,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  };
  const { data, isLoading } = useList(listInput);
  const updateMutation = useUpdate();
  const approveExecuteMutation = useApproveAndExecute();
  const executeMutation = useExecute();

  const handleReject = (id: string) => {
    updateMutation.mutate({ id, status: "rejected" });
  };

  const handleApproveOnly = (id: string) => {
    updateMutation.mutate({ id, status: "approved" });
  };

  const handleApproveAndExecute = (id: string) => {
    approveExecuteMutation.mutate({ id });
  };

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
        title="Approvals 审批队列"
        description="删除 Agent/文章、Git push 等危险操作会先进入此队列。批准后可在本页一键执行。"
        showDensityToggle
      />

      <div className="flex flex-wrap gap-2">
        {(["pending", "approved", "rejected", "executed", "all"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
              statusFilter === s
                ? "bg-[var(--kp-brand-deep)] text-white shadow-sm"
                : "bg-[var(--kp-bg-soft)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
            )}
          >
            {s === "all" ? "全部" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title={statusFilter === "pending" ? "暂无待审批项" : "没有匹配的审批记录"}
          description="当 delete / git.push 等操作被拦截时，会自动出现在此列表。"
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
                )}
                data-testid="approval-card"
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
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
                    <p className="text-[11px] text-[var(--kp-text-3)] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(approval.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>

                  {approval.status === "pending" && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleReject(approval.id)}
                        disabled={updateMutation.isPending}
                      >
                        <X className="w-3.5 h-3.5" />
                        拒绝
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => handleApproveOnly(approval.id)}
                        disabled={updateMutation.isPending}
                      >
                        <Check className="w-3.5 h-3.5" />
                        仅批准
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1 bg-[var(--kp-brand-deep)] text-white hover:bg-[var(--kp-brand-deep)]"
                        onClick={() => handleApproveAndExecute(approval.id)}
                        disabled={approveExecuteMutation.isPending}
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
