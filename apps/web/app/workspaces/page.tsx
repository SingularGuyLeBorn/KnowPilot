/**
 * Workspaces 工作区管理页面 — 显示 Workspace + 关联 Agent 信息
 */

"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Bot, Folder, HardDrive, MapPin, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Workspace } from "@knowpilot/shared";
import { useWorkspace, useCardDensity } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";

export default function WorkspacesPage() {
  const { useList, useCreate, useDelete } = useWorkspace();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const { data, isLoading, refetch } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", path: "", description: "", autoCreateManager: true });
  const [createError, setCreateError] = useState<string | null>(null);

  // 拉取所有 Agent，按 workspaceId 分组
  const agentsQuery = trpc.agent.list.useQuery({ page: 1, pageSize: 100 });
  const agentsByWorkspace = useMemo(() => {
    const map = new Map<string, { id: string; name: string; tier: string; status: string }[]>();
    for (const a of agentsQuery.data?.items ?? []) {
      if (a.workspaceId) {
        const arr = map.get(a.workspaceId) ?? [];
        arr.push({ id: a.id, name: a.name, tier: a.tier ?? "sub", status: a.status ?? "active" });
        map.set(a.workspaceId, arr);
      }
    }
    return map;
  }, [agentsQuery.data]);

  const handleCreate = async () => {
    setCreateError(null);
    const name = createForm.name.trim();
    const path = createForm.path.trim();
    if (!name || !path) { setCreateError("名称和路径不能为空"); return; }
    try {
      await createMutation.mutateAsync({ name, path, description: createForm.description.trim() || undefined, autoCreateManager: createForm.autoCreateManager });
      setShowCreate(false);
      setCreateForm({ name: "", path: "", description: "", autoCreateManager: true });
      void refetch();
    } catch (err) { setCreateError(err instanceof Error ? err.message : "创建失败"); }
  };

  const confirmDelete = () => { if (deleteId) { deleteMutation.mutate({ id: deleteId }); setDeleteId(null); } };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={HardDrive}
        title="Workspaces 工作空间"
        description="管理本地不同的 Markdown 目录和项目空间。每个 Workspace 自动创建一个管理 Agent，可包含多个子 Agent。"
        action={{ label: "创建新工作区", onClick: () => setShowCreate(true), icon: Plus }}
        showDensityToggle
      />

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState title="孤立的系统" description="目前还没有关联任何本地磁盘文件夹。点击下方按钮快速关联一个本地知识库。"
          actionLabel="关联本地工作区" onAction={() => setShowCreate(true)} />
      ) : (
        <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 ", density === "compact" ? "gap-4" : "gap-6")}>
          {data.items.map((workspace: Workspace, idx: number) => {
            const wsAgents = agentsByWorkspace.get(workspace.id) ?? [];
            const manager = wsAgents.find((a) => a.tier === "manager");
            return (
              <motion.div key={workspace.id}
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 } }}
                className={cn("group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 hover:bg-white dark:hover:bg-[var(--vp-c-bg-soft)] hover:border-[var(--vp-c-divider)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between", density === "compact" ? "p-3" : "p-5")}>
                <div>
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]">
                        <Folder className="w-4 h-4" />
                      </div>
                      <h3 className="font-bold text-[var(--vp-c-text-1)] group-hover:text-[var(--kp-brand-dark)] transition-colors text-sm">
                        {workspace.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/workspaces/edit/${workspace.id}`}
                        className="text-xs text-[var(--kp-brand)] hover:text-[var(--kp-brand-dark)] px-2 py-0.5 rounded hover:bg-[var(--kp-brand-soft)]">编辑</Link>
                      {(() => {
                        const hasSuper = wsAgents.some((a) => a.tier === "super");
                        return (
                          <span className={cn(hasSuper && "cursor-not-allowed")} title={hasSuper ? "该 Workspace 包含超级 Agent，不可注销" : undefined}>
                            <button
                              onClick={() => setDeleteId(workspace.id)}
                              disabled={hasSuper}
                              className="text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10 disabled:text-gray-400 disabled:hover:text-gray-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                            >
                              注销
                            </button>
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--vp-c-text-3)] min-h-[30px] mb-4">{workspace.description || "暂无描述。"}</p>
                </div>

                {/* Agent 关联信息 */}
                <div className="mb-3 space-y-1.5">
                  {manager && (
                    <div className="flex items-center gap-2 rounded-lg bg-blue-50/60 px-2 py-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="text-[11px] font-medium text-blue-700">管理 Agent</span>
                      <span className="ml-auto truncate text-[11px] text-blue-600">{manager.name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-2 py-1">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
                    <span className="text-[11px] text-[var(--kp-text-2)]">
                      {wsAgents.length > 0 ? (
                        <>
                          <span className="font-semibold">{wsAgents.length}</span> 个 Agent
                          {wsAgents.length <= 3 && (
                            <span className="ml-1.5 text-[var(--kp-text-3)]">· {wsAgents.map((a) => a.name).join("、")}</span>
                          )}
                        </>
                      ) : <span className="text-[var(--kp-text-3)]">暂无 Agent</span>}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--vp-c-divider-light)] space-y-1">
                  <div className="text-[9px] uppercase font-bold text-[var(--vp-c-text-3)] flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> 本地绝对路径
                  </div>
                  <code className="text-[10px] block p-1.5 rounded bg-[var(--vp-c-bg-mute)] font-mono text-[var(--vp-c-text-2)] truncate">{workspace.path}</code>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <ConfirmDialog isOpen={deleteId !== null} title="注销工作空间"
        description="确定要注销此本地工作空间吗？注销仅会从系统数据库中清除元数据配置，绝对不会删除你的本地真实文件夹和 Markdown 文件。"
        isDestructive={true} confirmLabel="确认注销" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">创建新工作区</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded p-1 hover:bg-[var(--kp-bg-mute)]"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs text-[var(--kp-text-3)]">名称</label><Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="我的知识库" /></div>
              <div><label className="mb-1 block text-xs text-[var(--kp-text-3)]">本地路径</label><Input value={createForm.path} onChange={(e) => setCreateForm({ ...createForm, path: e.target.value })} placeholder="D:/MyDocs" /></div>
              <div><label className="mb-1 block text-xs text-[var(--kp-text-3)]">描述</label><Input value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="可选" /></div>
              <label className="flex items-center gap-2 text-xs text-[var(--kp-text-2)]">
                <input type="checkbox" checked={createForm.autoCreateManager} onChange={(e) => setCreateForm({ ...createForm, autoCreateManager: e.target.checked })} className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand)]" />
                自动创建管理 Agent（推荐）
              </label>
              {createError && <p className="text-xs text-red-600">{createError}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
              <Button onClick={() => void handleCreate()} disabled={createMutation.isPending}>{createMutation.isPending ? "创建中…" : "创建"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
