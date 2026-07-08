/**
 * Workspaces 工作区管理页面 (L3 系统与运维)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { HardDrive, Plus, Folder, MapPin, ShieldCheck, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Workspace } from "@knowpilot/shared";
import { useWorkspace } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog } from "@/components/shared";
import { cn } from "@/lib/utils";

export default function WorkspacesPage() {
  const { useList, useCreate, useDelete } = useWorkspace();
  const [page] = useState(1);
  const { data, isLoading, refetch } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // 创建弹窗（#5）：name/path/description + autoCreateManager
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    path: "",
    description: "",
    autoCreateManager: true,
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreateError(null);
    const name = createForm.name.trim();
    const path = createForm.path.trim();
    if (!name || !path) {
      setCreateError("名称和路径不能为空");
      return;
    }
    try {
      await createMutation.mutateAsync({
        name,
        path,
        description: createForm.description.trim() || undefined,
        autoCreateManager: createForm.autoCreateManager,
      });
      setShowCreate(false);
      setCreateForm({ name: "", path: "", description: "", autoCreateManager: true });
      void refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建失败");
    }
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
          <HardDrive className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)]">
              <Sparkles className="w-3.5 h-3.5" />
              L3 阶段 · 多工作区管理
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Workspaces 工作空间
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              管理本地不同的 Markdown 目录和项目空间。切换不同的工作区会让智能代理自动切换执行上下文，操作对应的本地文件夹。
            </p>
          </div>

          <Button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] w-full md:w-auto shrink-0"
          >
            <Plus className="w-5 h-5" />
            创建新工作区
          </Button>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="孤立的系统"
          description="目前还没有关联任何本地磁盘文件夹。点击下方按钮快速关联一个本地知识库。"
          actionLabel="关联本地工作区"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.items.map((workspace: Workspace, idx: number) => (
            <motion.div
              key={workspace.id}
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
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]">
                      <Folder className="w-4 h-4" />
                    </div>
                    <h3 className="font-bold text-[var(--vp-c-text-1)] group-hover:text-[var(--vp-c-brand-dark)] transition-colors text-sm">
                      {workspace.name}
                    </h3>
                  </div>
                  
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link
                      href={`/workspaces/edit/${workspace.id}`}
                      className="text-xs text-[var(--vp-c-brand)] hover:text-[var(--vp-c-brand-dark)] px-2 py-0.5 rounded hover:bg-[var(--vp-c-brand-soft)]"
                    >
                      编辑
                    </Link>
                    <button
                      onClick={() => setDeleteId(workspace.id)}
                      className="text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                    >
                      注销
                    </button>
                  </div>
                </div>

                <p className="text-xs text-[var(--vp-c-text-3)] min-h-[30px] mb-4">
                  {workspace.description || "暂无描述。"}
                </p>
              </div>

              <div className="pt-3 border-t border-[var(--vp-c-divider-light)] space-y-1">
                <div className="text-[9px] uppercase font-bold text-[var(--vp-c-text-3)] flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  本地绝对路径
                </div>
                <code className="text-[10px] block p-1.5 rounded bg-[var(--vp-c-bg-mute)] font-mono text-[var(--vp-c-text-2)] truncate">
                  {workspace.path}
                </code>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="注销工作空间"
        description="确定要注销此本地工作空间吗？注销仅会从系统数据库中清除元数据配置，绝对不会删除你的本地真实文件夹和 Markdown 文件。"
        isDestructive={true}
        confirmLabel="确认注销"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* 创建 Workspace 弹窗（#5）：支持自动创建管理 Agent */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg-alt)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--vp-c-divider)] px-5 py-3.5">
              <h3 className="text-sm font-semibold text-[var(--vp-c-text-1)]">创建 Workspace</h3>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="关闭">
                <X className="h-4 w-4 text-[var(--vp-c-text-3)]" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--vp-c-text-3)]">名称</label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="技术博客"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--vp-c-text-3)]">本地路径（项目根内相对路径或绝对路径）</label>
                <Input
                  value={createForm.path}
                  onChange={(e) => setCreateForm({ ...createForm, path: e.target.value })}
                  placeholder="workspaces/techblog"
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--vp-c-text-3)]">描述（可选）</label>
                <Input
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="这个工作区做什么"
                />
              </div>
              <button
                type="button"
                onClick={() => setCreateForm({ ...createForm, autoCreateManager: !createForm.autoCreateManager })}
                className="flex w-full items-center justify-between rounded-xl border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg)] px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 text-xs text-[var(--vp-c-text-1)]">
                  <ShieldCheck className="h-4 w-4 text-blue-500" />
                  自动创建管理 Agent + 主会话
                </span>
                <span
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    createForm.autoCreateManager ? "bg-[var(--vp-c-brand)]" : "bg-[var(--vp-c-bg-mute)]",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                      createForm.autoCreateManager ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </span>
              </button>
              {createError && <p className="text-xs text-red-600">{createError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--vp-c-divider)] px-5 py-3.5">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void handleCreate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? "创建中…" : "创建"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
