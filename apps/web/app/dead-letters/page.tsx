/**
 * Dead Letters 邮件回复死信审计 (L5)
 *
 * 展示未匹配 pending 的邮件回复（webhook/poller 收到但找不到对应 ask_user/审批）。
 * 可标记已审阅、清空已审阅。
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { MailX, Check, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeadLetterList, useDeadLetterReview, useDeadLetterClear, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pending" | "reviewed";

export default function DeadLettersPage() {
  const { density } = useCardDensity();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const { data, isLoading } = useDeadLetterList(statusFilter);
  const reviewMutation = useDeadLetterReview();
  const clearMutation = useDeadLetterClear();

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="邮件回复死信"
        description="未匹配 pending 的邮件回复（webhook/轮询收到但找不到对应 ask_user/审批）。审计用，可追查为什么某封回复没生效。"
        icon={<MailX className="h-6 w-6" />}
      />

      <div className="mb-4 flex items-center gap-2">
        {(["pending", "reviewed", "all"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
              statusFilter === s ? "bg-kp-accent text-white" : "bg-kp-card hover:bg-kp-card-hover",
            )}
          >
            {s === "pending" ? "待审阅" : s === "reviewed" ? "已审阅" : "全部"}
          </button>
        ))}
        <div className="flex-1" />
        {statusFilter === "reviewed" || statusFilter === "all" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            清空已审阅
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          title="暂无死信"
          description="没有未匹配的邮件回复。邮件回复链路正常。"
          icon={<MailX className="h-10 w-10" />}
        />
      ) : (
        <div className="space-y-3">
          {items.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, type: "spring", stiffness: 260, damping: 26 }}
              className={cn(
                "kp-card-premium rounded-xl border border-kp-border/40 p-4",
                density === "compact" ? "py-3" : "py-4",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 text-xs text-kp-muted">
                    <Clock className="h-3 w-3" />
                    {new Date(d.createdAt).toLocaleString("zh-CN")}
                    <span className={cn("kp-badge", d.status === "pending" ? "kp-badge-warning" : "kp-badge-info")}>
                      {d.status === "pending" ? "待审阅" : "已审阅"}
                    </span>
                    <span className="kp-badge kp-badge-muted">{d.source}</span>
                  </div>
                  <div className="mb-1 text-sm font-medium text-kp-text">{d.subject ?? "(无主题)"}</div>
                  <div className="mb-2 text-xs text-kp-muted">
                    messageId={d.messageId ?? "-"} threadId={d.threadId ?? "-"} inReplyTo={d.inReplyTo ?? "-"}
                  </div>
                  <div className="mb-2 rounded-lg bg-kp-bg/50 p-2 text-sm text-kp-text">
                    <div className="mb-1 text-xs font-medium text-kp-muted">回复原文：</div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm">{d.text}</pre>
                  </div>
                  <div className="text-xs text-kp-danger">
                    <span className="font-medium">失败原因：</span>
                    {d.error}
                  </div>
                </div>
                {d.status === "pending" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reviewMutation.mutate({ id: d.id })}
                    disabled={reviewMutation.isPending}
                  >
                    <Check className="mr-1.5 h-4 w-4" />
                    标记已审阅
                  </Button>
                ) : null}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
