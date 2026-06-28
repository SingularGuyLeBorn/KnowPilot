/**
 * Memories 长期记忆管理页面 (L2 智能工作台)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Plus, Zap, Tag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Memory } from "@knowpilot/shared";
import { useMemory } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog } from "@/components/shared";

export default function MemoriesPage() {
  const { useList, useCreate, useDelete } = useMemory();
  const [page] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      content: `用户偏好使用中文编写技术文档，且非常注重代码的设计美感与莫兰迪色系。`,
      type: "preference",
      strength: 0.95,
      keywords: ["preference", "design", "language"],
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
          <Brain className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
              <Sparkles className="w-3.5 h-3.5" />
              L2 阶段 · 长期语义记忆
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Memories 记忆晶体
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              沉淀与用户的对话事实或喜好偏好。记忆以向量化和语义提取形式持久化存盘，在与 Agent 交互时被自动关联提取，使智能体愈加懂你。
            </p>
          </div>

          <Button
            onClick={handleCreateDemo}
            className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            写入记忆晶体
          </Button>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="记忆脑海空无一物"
          description="Agent 尚未从日常聊天中提取出持久记忆。你可以手动植入一颗关于偏好的记忆晶体。"
          actionLabel="植入偏好记忆"
          onAction={handleCreateDemo}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.items.map((memory: Memory, idx: number) => (
            <motion.div
              key={memory.id}
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
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--vp-c-brand-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--vp-c-brand)]">
                    {memory.type === "preference" ? "个性偏好" : "客观事实"}
                  </span>
                  
                  <button
                    onClick={() => setDeleteId(memory.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                  >
                    粉碎
                  </button>
                </div>

                <p className="text-xs text-[var(--vp-c-text-2)] leading-relaxed mb-4">
                  <span>&ldquo;{memory.content}&rdquo;</span>
                </p>
              </div>

              <div className="space-y-2 pt-3 border-t border-[var(--vp-c-divider-light)]">
                <div className="flex justify-between items-center text-[10px] text-[var(--vp-c-text-3)]">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-[var(--vp-c-brand)]" />
                    记忆强度: {memory.strength * 100}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {memory.keywords?.map((k: string) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-0.5 rounded bg-[var(--vp-c-bg-soft)] px-1.5 py-0.5 text-[8px] text-[var(--vp-c-text-3)] font-medium"
                    >
                      <Tag className="w-2 h-2" />
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="粉碎记忆碎片"
        description="确定要粉碎（删除）该条长期记忆吗？这会导致 Agent 忘记此信息，回复个性化程度可能受到影响。"
        isDestructive={true}
        confirmLabel="确认粉碎"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
