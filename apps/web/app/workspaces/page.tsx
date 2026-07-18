/**
 * Workspaces 工作区管理页面 — 控制台式卡片：配额 / 状态 / Agent 分层
 */

"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Bot,
  Crown,
  Folder,
  Gauge,
  HardDrive,
  MapPin,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Workspace } from "@knowpilot/shared";
import { useWorkspace, useCardDensity } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { AdminPage, EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";

export default function WorkspacesPage() {
  const { useList, useCreate, useDelete } = useWorkspace();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const { data, isLoading, refetch } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const utils = trpc.useUtils();
  const resetAssistantMut = trpc.workspace.resetAssistantHome.useMutation({
    onSuccess: () => {
      void utils.workspace.list.invalidate();
      void utils.agent.list.invalidate();
      void utils.session.list.invalidate();
    },
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    path: "",
    description: "",
    autoCreateManager: true,
    asyncSlotQuota: 2,
    managerName: "",
    initialTask: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);

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
    // 系统 Workspace：把无 workspaceId 的超级 Agent 挂到 isSystem 空间上展示
    const supers = (agentsQuery.data?.items ?? []).filter(
      (a) => a.tier === "super" && !a.workspaceId,
    );
    if (supers.length && data?.items) {
      for (const ws of data.items) {
        if (!ws.isSystem) continue;
        const arr = map.get(ws.id) ?? [];
        for (const s of supers) {
          if (!arr.some((x) => x.id === s.id)) {
            arr.push({ id: s.id, name: s.name, tier: "super", status: s.status ?? "active" });
          }
        }
        map.set(ws.id, arr);
      }
    }
    return map;
  }, [agentsQuery.data, data?.items]);

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
        asyncSlotQuota: createForm.asyncSlotQuota,
        managerName: createForm.managerName.trim() || undefined,
        initialTask: createForm.initialTask.trim() || undefined,
      });
      setShowCreate(false);
      setCreateForm({
        name: "",
        path: "",
        description: "",
        autoCreateManager: true,
        asyncSlotQuota: 2,
        managerName: "",
        initialTask: "",
      });
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
    <AdminPage>
      <PageHeader
        icon={HardDrive}
        title="Workspaces 工作空间"
        description="本地目录 + 管理 Agent + 异步槽配额。每个普通 Workspace 可自动创建管理 Agent。"
        action={{ label: "创建新工作区", onClick: () => setShowCreate(true), icon: Plus }}
        showDensityToggle
      />

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
        <div
          className={cn(
            "grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]",
            density === "compact" ? "gap-4" : "gap-6",
          )}
        >
          {data.items.map((workspace: Workspace, idx: number) => {
            const wsAgents = agentsByWorkspace.get(workspace.id) ?? [];
            const manager = wsAgents.find((a) => a.tier === "manager");
            const supers = wsAgents.filter((a) => a.tier === "super");
            const subs = wsAgents.filter((a) => a.tier === "sub");
            const quotaLabel =
              workspace.asyncSlotQuota === 0 ? "槽位不限" : `槽位 ${workspace.asyncSlotQuota}`;
            return (
              <motion.div
                key={workspace.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 },
                }}
                className={cn(
                  "group relative flex flex-col justify-between overflow-hidden rounded-2xl border transition-all duration-300",
                  workspace.isSystem
                    ? "border-amber-200/70 bg-gradient-to-br from-amber-50/40 to-[var(--kp-bg-alt)]"
                    : "border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] hover:border-[var(--kp-divider)] hover:shadow-xl",
                  density === "compact" ? "p-3" : "p-5",
                )}
              >
                <div>
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                        <Folder className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-[var(--kp-text-1)] group-hover:text-[var(--kp-brand-deep)]">
                          {workspace.name}
                        </h3>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {workspace.isSystem && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
                              {workspace.systemType === "super"
                                ? "Root"
                                : workspace.systemType === "assistant"
                                  ? "Assistant Home"
                                  : "系统"}
                            </span>
                          )}
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                              workspace.status === "active"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-100 text-gray-500",
                            )}
                          >
                            {workspace.status}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Link
                        href={`/workspaces/edit/${workspace.id}`}
                        className="rounded px-2 py-0.5 text-xs text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                      >
                        编辑
                      </Link>
                      {workspace.systemType === "assistant" && (
                        <button
                          type="button"
                          onClick={() => setResetConfirm(true)}
                          disabled={resetAssistantMut.isPending}
                          className="rounded px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                          title="归档会话并恢复助手默认配置；不动长期记忆"
                        >
                          重置
                        </button>
                      )}
                      {(() => {
                        const locked = workspace.isSystem || supers.length > 0;
                        return (
                          <span
                            className={cn(locked && "cursor-not-allowed")}
                            title={locked ? "系统 Workspace / 含超级 Agent，不可注销" : undefined}
                          >
                            <button
                              type="button"
                              onClick={() => setDeleteId(workspace.id)}
                              disabled={locked}
                              className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                              注销
                            </button>
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <p className="mb-3 min-h-[30px] text-xs text-[var(--kp-text-3)]">
                    {workspace.description || "暂无描述。"}
                  </p>
                </div>

                <div className="mb-3 space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--kp-bg)] px-2 py-1.5 text-[11px]">
                    <Gauge className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
                    <span className="font-medium text-[var(--kp-text-1)]">{quotaLabel}</span>
                    <span className="text-[var(--kp-text-3)]">· 后台 LLM 并发</span>
                  </div>
                  {manager && (
                    <div className="flex items-center gap-2 rounded-lg bg-blue-50/60 px-2 py-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="text-[11px] font-medium text-blue-700">管理 Agent</span>
                      <span className="ml-auto truncate text-[11px] text-blue-600">{manager.name}</span>
                    </div>
                  )}
                  {supers.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-lg bg-amber-50/70 px-2 py-1.5"
                    >
                      <Crown className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span className="text-[11px] font-medium text-amber-800">超级 Agent</span>
                      <span className="ml-auto truncate text-[11px] text-amber-700">{s.name}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 px-2 py-1">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
                    <span className="text-[11px] text-[var(--kp-text-2)]">
                      {wsAgents.length > 0 ? (
                        <>
                          <span className="font-semibold">{wsAgents.length}</span> 个 Agent
                          <span className="ml-1.5 text-[var(--kp-text-3)]">
                            · 管理 {manager ? 1 : 0} · 子 {subs.length}
                            {supers.length ? ` · 超级 ${supers.length}` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-[var(--kp-text-3)]">暂无 Agent</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 border-t border-[var(--kp-divider-light)] pt-3">
                  <div className="flex items-center gap-1 text-[9px] font-bold uppercase text-[var(--kp-text-3)]">
                    <MapPin className="h-3 w-3" /> 本地路径
                  </div>
                  <code className="block truncate rounded bg-[var(--kp-bg-mute)] p-1.5 font-mono text-[10px] text-[var(--kp-text-2)]">
                    {workspace.path}
                  </code>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="注销工作空间"
        description="确定要注销此本地工作空间吗？注销仅会从系统数据库中清除元数据配置，绝对不会删除你的本地真实文件夹和 Markdown 文件。"
        isDestructive
        confirmLabel="确认注销"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        isOpen={resetConfirm}
        title="重置 Assistant Home"
        description="将归档默认助手的全部活跃会话、清空待发队列，并把工具清单与系统提示恢复为内置默认。长期记忆与 pinned 不会删除。"
        isDestructive={false}
        confirmLabel={resetAssistantMut.isPending ? "重置中…" : "确认重置"}
        onConfirm={() => {
          resetAssistantMut.mutate(undefined, {
            onSettled: () => setResetConfirm(false),
          });
        }}
        onCancel={() => setResetConfirm(false)}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">创建新工作区</h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded p-1 hover:bg-[var(--kp-bg-mute)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--kp-text-3)]">名称</label>
                <Input
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="我的知识库"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--kp-text-3)]">本地路径</label>
                <Input
                  value={createForm.path}
                  onChange={(e) => setCreateForm({ ...createForm, path: e.target.value })}
                  placeholder="D:/MyDocs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--kp-text-3)]">描述</label>
                <Input
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="可选"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--kp-text-3)]">异步 LLM 槽位配额</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={createForm.asyncSlotQuota}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, asyncSlotQuota: Number(e.target.value) || 0 })
                  }
                />
                <p className="mt-1 text-[10px] text-[var(--kp-text-3)]">0 = 不限；默认 2</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--kp-text-2)]">
                <input
                  type="checkbox"
                  checked={createForm.autoCreateManager}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, autoCreateManager: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand-deep)]"
                />
                自动创建管理 Agent（推荐）
              </label>
              {createForm.autoCreateManager && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--kp-text-3)]">
                      管理 Agent 名称（可选）
                    </label>
                    <Input
                      value={createForm.managerName}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, managerName: e.target.value })
                      }
                      placeholder="默认：{工作区名} 管理 Agent"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--kp-text-3)]">
                      初始任务（可选，写入管理 Agent 首条消息）
                    </label>
                    <textarea
                      value={createForm.initialTask}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, initialTask: e.target.value })
                      }
                      rows={3}
                      placeholder="例如：梳理本目录结构并建立索引"
                      className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand-deep)]"
                    />
                  </div>
                </>
              )}
              {createError && <p className="text-xs text-red-600">{createError}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                取消
              </Button>
              <Button onClick={() => void handleCreate()} disabled={createMutation.isPending}>
                {createMutation.isPending ? "创建中…" : "创建"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
