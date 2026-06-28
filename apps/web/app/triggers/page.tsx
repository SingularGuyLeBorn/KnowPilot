/**
 * Triggers 事件触发器管理页面 (L4)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Plus, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Trigger } from "@knowpilot/shared";
import { useTrigger } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination } from "@/components/shared";

const EVENT_SOURCES = ["post.create", "post.update", "post.delete", "agent.create", "skill.create"];
const ACTION_TYPES = ["run_agent", "run_task"] as const;

export default function TriggersPage() {
  const { useList, useCreate, useUpdate, useDelete } = useTrigger();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `文章创建后同步_${Date.now().toString(36).slice(-4)}`,
      type: "file_change",
      source: "post.create",
      actionType: "run_task",
      actionId: "placeholder-task-id",
      enabled: false,
    });
  };

  const toggleEnabled = (trigger: Trigger) => {
    updateMutation.mutate({ id: trigger.id, enabled: !trigger.enabled });
  };

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
          <Zap className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
              <Sparkles className="w-3.5 h-3.5" />
              L4 · 事件自动化
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Triggers 触发器
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              当 post.create 等事件发生时，自动唤醒 Agent 或执行后台 Task。source 格式为 entity.action。
            </p>
          </div>

          <Button
            onClick={handleCreateDemo}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            新建触发器
          </Button>
        </div>
      </motion.div>

      <div className="rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/30 p-4 text-xs text-[var(--vp-c-text-3)]">
        <p className="font-semibold text-[var(--vp-c-text-2)] mb-1">常用事件源</p>
        <code className="text-[10px]">{EVENT_SOURCES.join(" · ")}</code>
        <p className="mt-2 font-semibold text-[var(--vp-c-text-2)] mb-1">动作类型</p>
        <code className="text-[10px]">{ACTION_TYPES.join(" · ")}</code>
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="尚未配置触发器"
          description="创建规则后，TriggerEngine 会在 server 启动时监听 AppEventBus 事件。"
          actionLabel="创建示例规则"
          onAction={handleCreateDemo}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {data.items.map((trigger: Trigger, idx: number) => (
              <motion.div
                key={trigger.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 },
                }}
                className="group rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 p-5 hover:shadow-lg transition-all"
              >
                <div className="flex justify-between items-start gap-4 mb-4">
                  <div>
                    <h3 className="font-bold text-[var(--vp-c-text-1)]">{trigger.name}</h3>
                    <p className="text-[10px] text-[var(--vp-c-text-3)] mt-1">
                      {trigger.type} · {trigger.actionType}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleEnabled(trigger)}
                    className="flex items-center gap-1 text-xs text-[var(--vp-c-brand)]"
                    aria-label={trigger.enabled ? "禁用" : "启用"}
                  >
                    {trigger.enabled ? (
                      <ToggleRight className="w-5 h-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-[var(--vp-c-text-3)]" />
                    )}
                    {trigger.enabled ? "已启用" : "已禁用"}
                  </button>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-[var(--vp-c-text-3)]">事件源 </span>
                    <code className="bg-[var(--vp-c-bg-mute)] px-1.5 py-0.5 rounded font-mono">{trigger.source}</code>
                  </div>
                  <div>
                    <span className="text-[var(--vp-c-text-3)]">动作 ID </span>
                    <code className="bg-[var(--vp-c-bg-mute)] px-1.5 py-0.5 rounded font-mono text-[10px]">{trigger.actionId}</code>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--vp-c-divider-light)] flex justify-end">
                  <button
                    onClick={() => setDeleteId(trigger.id)}
                    className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-500/10"
                  >
                    删除
                  </button>
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

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="删除触发器"
        description="删除后该事件将不再自动触发关联动作。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
