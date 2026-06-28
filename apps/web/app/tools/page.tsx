/**
 * Tools 工具注册表管理页面 (L2/L4 运行时)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Wrench, Plus, Sparkles, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Tool } from "@knowpilot/shared";
import { useTool } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination } from "@/components/shared";

const TYPE_LABEL: Record<Tool["type"], string> = {
  native: "原生工具",
  skill: "Skill 绑定",
  mcp: "MCP 绑定",
};

export default function ToolsPage() {
  const { useList, useCreate, useDelete } = useTool();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `custom_tool_${Date.now().toString(36).slice(-4)}`,
      type: "native",
      description: "示例：注册到 Tool 表的自定义原生工具元数据。",
      enabled: true,
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
          <Wrench className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
              <Sparkles className="w-3.5 h-3.5" />
              L4 · 工具注册表
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Tools 工具目录
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              统一管理 Native / Skill / MCP 三类工具的注册元数据，供 Agent 运行时与 ai.tools 反射发现。
            </p>
          </div>

          <Button
            onClick={handleCreateDemo}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            注册示例工具
          </Button>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="工具注册表为空"
          description="尚未注册任何工具元数据。Agent 仍可使用内置 nativeTools，但自定义工具需在此登记。"
          actionLabel="添加示例工具"
          onAction={handleCreateDemo}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.items.map((tool: Tool, idx: number) => (
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.04, type: "spring", stiffness: 200, damping: 20 },
                }}
                className="group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 p-5 hover:bg-white dark:hover:bg-[var(--vp-c-bg-soft)] hover:border-[var(--vp-c-divider)] hover:shadow-xl transition-all duration-300"
              >
                <div className="flex justify-between items-start gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]">
                      <Cpu className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[var(--vp-c-text-1)] group-hover:text-[var(--vp-c-brand-dark)]">
                        {tool.name}
                      </h3>
                      <span className="text-[10px] text-[var(--vp-c-text-3)]">{TYPE_LABEL[tool.type]}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteId(tool.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                  >
                    删除
                  </button>
                </div>

                <p className="text-xs text-[var(--vp-c-text-3)] min-h-[32px] mb-4 line-clamp-2">
                  {tool.description || "无描述"}
                </p>

                <div className="flex items-center justify-between border-t border-[var(--vp-c-divider-light)] pt-3 text-[10px] text-[var(--vp-c-text-3)]">
                  <span className="font-mono truncate max-w-[60%]">{tool.targetId || "—"}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-medium ${
                      tool.enabled ? "bg-green-500/10 text-green-600" : "bg-gray-500/10 text-gray-500"
                    }`}
                  >
                    {tool.enabled ? "已启用" : "已禁用"}
                  </span>
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
        title="删除工具注册"
        description="确定要从工具注册表中删除该条目吗？不会影响实际 nativeTools 实现。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
