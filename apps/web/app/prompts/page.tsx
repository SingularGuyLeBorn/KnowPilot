/**
 * Prompts 提示词模板管理页面 (L2/L4)
 */

"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { FileCode2, Plus, Tag } from "lucide-react";
import Link from "next/link";
import type { Prompt } from "@knowpilot/shared";
import { usePrompt, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination, PageHeader } from "@/components/shared";

export default function PromptsPage() {
  const { useList, useCreate, useDelete } = usePrompt();
  const { density } = useCardDensity();
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
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={FileCode2}
        title="Prompts 提示词库"
        description="管理可复用的系统/用户提示词模板，支持变量占位与 Markdown 同步到 content/prompts/。"
        action={{ label: "新建模板", onClick: handleCreateDemo, icon: Plus, disabled: createMutation.isPending }}
        showDensityToggle
      />

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
          <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] ", density === "compact" ? "gap-4" : "gap-6")}>
            {data.items.map((prompt: Prompt, idx: number) => (
              <motion.div
                key={prompt.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 },
                }}
                className={cn("kp-card-premium kp-lift group relative overflow-hidden rounded-2xl flex flex-col justify-between", density === "compact" ? "p-3" : "p-5")}
              >
                <div>
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div>
                      <h3 className="font-bold text-[var(--kp-text-1)] group-hover:text-[var(--kp-brand-deep)] transition-colors">
                        {prompt.name}
                      </h3>
                      <p className="text-[10px] text-[var(--kp-text-3)]">v{prompt.version}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link
                        href={`/prompts/edit/${prompt.id}`}
                        className="text-xs text-[var(--kp-brand-deep)] hover:text-[var(--kp-brand-deep)] px-2 py-0.5 rounded hover:bg-[var(--kp-brand-soft)]"
                      >
                        编辑
                      </Link>
                      <button
                        onClick={() => setDeleteId(prompt.id)}
                        className="text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {prompt.description && (
                    <p className="text-xs text-[var(--kp-text-2)] mb-3 line-clamp-2">{prompt.description}</p>
                  )}

                  <pre className="text-[10px] text-[var(--kp-text-3)] bg-[var(--kp-bg-mute)] rounded-lg p-2 max-h-24 overflow-hidden line-clamp-4 font-mono whitespace-pre-wrap">
                    {prompt.content}
                  </pre>
                </div>

                <div className="pt-3 mt-3 border-t border-[var(--kp-divider-light)] flex flex-wrap gap-1">
                  {prompt.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 rounded bg-[var(--kp-bg-soft)] px-1.5 py-0.5 text-[8px] text-[var(--kp-text-3)]"
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
