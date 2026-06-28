/**
 * Prompts 提示词模板管理页面 (L2/L4)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { FileCode2, Plus, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Prompt } from "@knowpilot/shared";
import { usePrompt } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination } from "@/components/shared";

export default function PromptsPage() {
  const { useList, useCreate, useDelete } = usePrompt();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `assistant-system-${Date.now().toString(36).slice(-4)}`,
      version: "1.0.0",
      description: "Agent 系统提示词模板示例",
      variables: ["userName", "context"],
      tags: ["system", "chat"],
      content: "你是 KnowPilot 助手。用户 {{userName}} 的上下文：{{context}}\n\n请用简洁中文回答。",
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
          <FileCode2 className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
              <Sparkles className="w-3.5 h-3.5" />
              L2 · 提示词模板
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Prompts 提示词库
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              管理可复用的系统/用户提示词模板，支持变量占位与 Markdown 同步到 content/prompts/。
            </p>
          </div>

          <Button
            onClick={handleCreateDemo}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            新建模板
          </Button>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="尚无提示词模板"
          description="创建第一个模板，供 Agent 或工作流引用。"
          actionLabel="创建示例模板"
          onAction={handleCreateDemo}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.items.map((prompt: Prompt, idx: number) => (
              <motion.div
                key={prompt.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 },
                }}
                className="group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 p-5 hover:bg-white dark:hover:bg-[var(--vp-c-bg-soft)] hover:border-[var(--vp-c-divider)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div>
                      <h3 className="font-bold text-[var(--vp-c-text-1)] group-hover:text-[var(--vp-c-brand-dark)] transition-colors">
                        {prompt.name}
                      </h3>
                      <p className="text-[10px] text-[var(--vp-c-text-3)]">v{prompt.version}</p>
                    </div>
                    <button
                      onClick={() => setDeleteId(prompt.id)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                    >
                      删除
                    </button>
                  </div>

                  {prompt.description && (
                    <p className="text-xs text-[var(--vp-c-text-2)] mb-3 line-clamp-2">{prompt.description}</p>
                  )}

                  <pre className="text-[10px] text-[var(--vp-c-text-3)] bg-[var(--vp-c-bg-mute)] rounded-lg p-2 max-h-24 overflow-hidden line-clamp-4 font-mono whitespace-pre-wrap">
                    {prompt.content}
                  </pre>
                </div>

                <div className="pt-3 mt-3 border-t border-[var(--vp-c-divider-light)] flex flex-wrap gap-1">
                  {prompt.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 rounded bg-[var(--vp-c-bg-soft)] px-1.5 py-0.5 text-[8px] text-[var(--vp-c-text-3)]"
                    >
                      <Tag className="w-2 h-2" />
                      {tag}
                    </span>
                  ))}
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
        title="删除提示词模板"
        description="确定删除该模板吗？本地 content/prompts/ 文件也会一并移除。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
