"use client";

import React, { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Crown,
  HardDrive,
  Loader2,
  Save,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/hooks";
import type { Workspace } from "@knowpilot/shared";
import { AdminFormShell, KpSelect } from "@/components/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "active", label: "活跃 active" },
  { value: "archived", label: "已归档 archived" },
] as const;

function formatTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(v);
  }
}

export default function WorkspaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useWorkspace();
  const { data: workspace, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Workspace>>({});
  const [error, setError] = useState<string | null>(null);

  const agentsQuery = trpc.agent.list.useQuery({ page: 1, pageSize: 100 }, { enabled: !!id });

  const wsAgents = useMemo(() => {
    const items = agentsQuery.data?.items ?? [];
    return items.filter(
      (a) =>
        a.workspaceId === id ||
        a.id === workspace?.managerAgentId ||
        (!!workspace?.isSystem && a.tier === "super" && !a.workspaceId),
    );
  }, [agentsQuery.data?.items, id, workspace?.managerAgentId, workspace?.isSystem]);

  const manager = useMemo(
    () =>
      wsAgents.find((a) => a.id === workspace?.managerAgentId) ??
      wsAgents.find((a) => a.tier === "manager"),
    [wsAgents, workspace?.managerAgentId],
  );

  const tierCounts = useMemo(() => {
    const c = { super: 0, manager: 0, sub: 0 };
    for (const a of wsAgents) {
      const t = (a.tier ?? "sub") as keyof typeof c;
      if (t in c) c[t] += 1;
    }
    return c;
  }, [wsAgents]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-2 text-center">
          <p className="text-[var(--kp-text-2)]">Workspace 不存在</p>
          <Link href="/workspaces" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Workspace>(key: K) =>
    form[key] !== undefined ? form[key] : workspace[key];

  const updateField = <K extends keyof Workspace>(key: K, val: Workspace[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const isSystem = !!workspace.isSystem;
  const status = String(value("status") ?? "active");
  const quota = Number(value("asyncSlotQuota") ?? 2);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: workspace.id,
        name: String(form.name ?? workspace.name),
        description: (form.description !== undefined ? form.description : workspace.description) ?? undefined,
        path: isSystem ? undefined : String(form.path ?? workspace.path),
        asyncSlotQuota: Number(form.asyncSlotQuota ?? workspace.asyncSlotQuota ?? 2),
        status: isSystem ? undefined : (status as "active" | "archived"),
      },
      {
        onSuccess: () => router.push("/workspaces"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <AdminFormShell>
      <div className="flex items-center gap-3">
        <Link
          href="/workspaces"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--kp-text-1)] hover:bg-[var(--kp-bg-soft)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--kp-text-1)]">
            <HardDrive className="h-5 w-5 shrink-0 text-[var(--kp-brand-deep)]" />
            <span className="truncate">{workspace.name}</span>
            {isSystem && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                系统 Workspace
              </span>
            )}
          </h1>
          <p className="truncate font-mono text-xs text-[var(--kp-text-3)]">ID: {workspace.id}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {/* 左：可编辑 */}
        <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 md:p-6">
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">基本配置</h2>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">名称</label>
            <Input
              value={String(value("name") ?? "")}
              onChange={(e) => updateField("name", e.target.value)}
              className="bg-[var(--kp-bg)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">描述</label>
            <textarea
              value={String(value("description") ?? "")}
              onChange={(e) => updateField("description", e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">本地路径</label>
            <Input
              value={String(value("path") ?? "")}
              onChange={(e) => updateField("path", e.target.value)}
              disabled={isSystem}
              className="bg-[var(--kp-bg)] font-mono text-xs disabled:opacity-60"
            />
            {isSystem && (
              <p className="text-[11px] text-[var(--kp-text-3)]">系统 Workspace 路径固定，不可修改。</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">异步 LLM 槽位配额</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={Number.isFinite(quota) ? quota : 2}
                onChange={(e) => updateField("asyncSlotQuota", Number(e.target.value))}
                className="bg-[var(--kp-bg)]"
              />
              <p className="text-[11px] text-[var(--kp-text-3)]">
                本空间后台 LLM 任务并发上限；0 = 不限（仍受全局 maxConcurrent）。默认 2。
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">状态</label>
              <KpSelect
                value={status === "deleted" ? "archived" : status}
                onChange={(v) => updateField("status", v as Workspace["status"])}
                options={[...STATUS_OPTIONS]}
                className="w-full"
                aria-label="Workspace 状态"
                disabled={isSystem}
              />
              {isSystem && (
                <p className="text-[11px] text-[var(--kp-text-3)]">系统 Workspace 必须保持活跃。</p>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              disabled={update.isPending}
              className="bg-[var(--kp-brand-deep)] text-white hover:bg-[var(--kp-brand-deep)]"
            >
              {update.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存
            </Button>
            <Button variant="outline" type="button" onClick={() => router.push("/workspaces")}>
              取消
            </Button>
          </div>
        </div>

        {/* 右：只读概览 */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 md:p-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Layers className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              元数据
            </h2>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--kp-text-3)]">类型</dt>
                <dd className="font-medium text-[var(--kp-text-1)]">
                  {isSystem ? `系统 · ${workspace.systemType || "super"}` : "普通 Workspace"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--kp-text-3)]">状态</dt>
                <dd className="font-medium text-[var(--kp-text-1)]">{workspace.status}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--kp-text-3)]">槽位配额</dt>
                <dd className="font-medium text-[var(--kp-text-1)]">
                  {workspace.asyncSlotQuota === 0 ? "不限" : workspace.asyncSlotQuota}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--kp-text-3)]">创建</dt>
                <dd className="text-[var(--kp-text-2)]">{formatTime(workspace.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--kp-text-3)]">更新</dt>
                <dd className="text-[var(--kp-text-2)]">{formatTime(workspace.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 md:p-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Bot className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              关联 Agent
              <span className="ml-auto text-[11px] font-normal text-[var(--kp-text-3)]">
                共 {wsAgents.length} 个
              </span>
            </h2>

            <div className="mb-3 flex flex-wrap gap-1.5 text-[10px]">
              {tierCounts.super > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                  <Crown className="h-3 w-3" /> 超级 {tierCounts.super}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                <ShieldCheck className="h-3 w-3" /> 管理 {tierCounts.manager}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[var(--kp-text-2)]">
                <Bot className="h-3 w-3" /> 子 Agent {tierCounts.sub}
              </span>
            </div>

            {manager && (
              <div className="mb-3 rounded-lg border border-blue-200/60 bg-blue-50/50 px-3 py-2 text-xs">
                <div className="font-medium text-blue-800">管理 Agent</div>
                <Link
                  href={`/agents`}
                  className="mt-0.5 block truncate text-blue-700 hover:underline"
                  title={manager.name}
                >
                  {manager.name}
                </Link>
              </div>
            )}

            {wsAgents.length === 0 ? (
              <p className="text-xs text-[var(--kp-text-3)]">暂无归属本空间的 Agent。</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {wsAgents.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                      "bg-[var(--kp-bg)] border border-[var(--kp-divider-light)]",
                    )}
                  >
                    {a.tier === "super" ? (
                      <Crown className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    ) : a.tier === "manager" ? (
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--kp-text-1)]">
                      {a.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--kp-text-3)]">{a.status}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/agents`}
                className="text-[11px] font-medium text-[var(--kp-brand-deep)] hover:underline"
              >
                打开 Agents 管理 →
              </Link>
              <Link
                href={`/chat`}
                className="text-[11px] font-medium text-[var(--kp-brand-deep)] hover:underline"
              >
                打开 Chat →
              </Link>
            </div>
          </div>
        </div>
      </form>
    </AdminFormShell>
  );
}
