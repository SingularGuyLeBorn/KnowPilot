/**
 * Tasks 后台任务管理页面 (L3 系统与运维)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Plus, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Task } from "@knowpilot/shared";
import { useTask } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog } from "@/components/shared";

export default function TasksPage() {
  const { useList, useCreate, useDelete, useRun } = useTask();
  const [page] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const runMutation = useRun();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `内容单向同步编译器_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      type: "cron",
      status: "pending",
      input: { action: "db:sync" },
      output: {},
      cronExpression: "*/30 * * * *",
    });
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
          <CalendarClock className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
              <Sparkles className="w-3.5 h-3.5" />
              L3 阶段 · 计划与后台作业
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Tasks 定时任务
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              配置定期备份、增量编译、健康检查或 AI 定期摘要的自动化脚本作业，让 KnowPilot 系统独立且持续地后台运营。
            </p>
          </div>

          <Button
            onClick={handleCreateDemo}
            className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            新建定时任务
          </Button>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="作业流空荡"
          description="系统目前尚未安排任何定时运行的后台任务。点击按钮快速创建一个数据库自动备份任务。"
          actionLabel="添加自动备份任务"
          onAction={handleCreateDemo}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.items.map((task: Task, idx: number) => {
            const statusColors = {
              pending: "bg-yellow-500/10 text-yellow-600",
              running: "bg-blue-500/10 text-blue-500 animate-pulse",
              success: "bg-green-500/10 text-green-500",
              failed: "bg-red-500/10 text-red-500",
            };
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ 
                  opacity: 1, 
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 }
                }}
                className="group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 p-5 hover:bg-white dark:hover:bg-[var(--vp-c-bg-soft)] hover:border-[var(--vp-c-divider)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]">
                        <CalendarClock className="w-4 h-4" />
                      </div>
                      <h3 className="font-bold text-[var(--vp-c-text-1)] group-hover:text-[var(--vp-c-brand-dark)] transition-colors text-xs truncate max-w-[150px]">
                        {task.name}
                      </h3>
                    </div>
                    
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link
                        href={`/tasks/edit/${task.id}`}
                        className="text-xs text-[var(--vp-c-brand)] hover:text-[var(--vp-c-brand-dark)] px-2 py-0.5 rounded hover:bg-[var(--vp-c-brand-soft)]"
                      >
                        编辑
                      </Link>
                      <button
                        onClick={() => setDeleteId(task.id)}
                        className="text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 mb-4 text-[10px]">
                    <div className="text-[9px] uppercase font-bold text-[var(--vp-c-text-3)]">Cron 表达式</div>
                    <code className="block p-1 bg-[var(--vp-c-bg-mute)] font-mono text-[var(--vp-c-text-2)] rounded">
                      {task.cronExpression || "单次执行"}
                    </code>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--vp-c-divider-light)] flex justify-between items-center text-[10px]">
                  <span className={`px-2 py-0.5 rounded-full font-medium ${statusColors[task.status as keyof typeof statusColors]}`}>
                    {task.status.toUpperCase()}
                  </span>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-[10px] text-[var(--vp-c-brand)] hover:bg-[var(--vp-c-brand-soft)]"
                    onClick={() => runMutation.mutate({ id: task.id })}
                    disabled={runMutation.isPending || task.status === "running"}
                  >
                    <Play className="w-3 h-3" />
                    即刻执行
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="删除后台任务"
        description="确定要彻底删除该后台定时任务吗？删除后此项自动化作业（如备份）将不再执行。"
        isDestructive={true}
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
