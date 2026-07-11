/**
 * Agent 管理页面 — 参考 MetaBlog Agent 档案馆
 */

"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Bot,
  ChevronLeft,
  Cpu,
  Crown,
  Folder,
  HeartPulse,
  Lock,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Agent } from "@knowpilot/shared";
import { CHAT_MODELS, materializeAgentTools } from "@knowpilot/shared";
import { useAgent, useCardDensity, type CardDensity } from "@/lib/hooks";
import { EmptyState, KpSelect, LoadingState, ConfirmDialog, Pagination, CardDensityToggle } from "@/components/shared";
import { AgentToolsEditor, AgentToolSummaryCard } from "@/components/AgentToolsEditor";
import { AgentAvatar } from "@/components/agentAvatar";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type AgentForm = {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  // 心跳配置（#4）
  heartbeatEnabled: boolean;
  heartbeatCron: string;
  heartbeatGoal: string;
};

/** 心跳 cron 预设 */
const HEARTBEAT_CRON_PRESETS = [
  { value: "0 9 * * *", label: "每天 9:00" },
  { value: "0 */6 * * *", label: "每 6 小时" },
  { value: "0 */12 * * *", label: "每 12 小时" },
  { value: "0 9 * * 1", label: "每周一 9:00" },
  { value: "*/30 * * * *", label: "每 30 分钟" },
];

const DEFAULT_AGENT_TOOLS = [
  "native:web_search",
  "native:read_article",
  "native:read_file",
  "native:write_file",
  "native:list_directory",
  "native:invoke_api",
  "native:spawn_subagent",
  "native:async_task_run",
  "native:async_task_status",
  "native:async_task_wait",
  "native:async_task_cancel",
  "native:sleep",
  "native:git_status",
  "skill:*",
  "mcp:filesystem",
];

const EMPTY_FORM: AgentForm = {
  name: "",
  description: "",
  model: "deepseek-v4-flash",
  systemPrompt: "你是 KnowPilot 智能助手，擅长知识管理与 Markdown 写作。",
  tools: [...DEFAULT_AGENT_TOOLS],
  heartbeatEnabled: false,
  heartbeatCron: "0 9 * * *",
  heartbeatGoal: "",
};

const TIER_OPTIONS = [
  { value: "", label: "全部层级" },
  { value: "super", label: "超级 Agent" },
  { value: "manager", label: "管理 Agent" },
  { value: "sub", label: "子 Agent" },
];

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "active", label: "活跃" },
  { value: "idle", label: "空闲" },
  { value: "dormant", label: "休眠" },
  { value: "deleted", label: "已删除" },
];

const TIER_RANK: Record<string, number> = { super: 0, manager: 1, sub: 2 };

function modelOptions(currentModel: string) {
  const options = CHAT_MODELS.map((m) => ({ value: m.id, label: m.label }));
  if (currentModel && !options.some((o) => o.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel}（当前配置）` });
  }
  return options;
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** 单张 Agent 卡片 — memo 避免父组件搜索输入时整页重绘 */
const AgentCard = memo(function AgentCard({
  agent,
  selected,
  density,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  agent: Agent;
  selected: boolean;
  density: CardDensity;
  onToggleSelect: (id: string) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (id: string) => void;
}) {
  const handleToggle = useCallback(() => onToggleSelect(agent.id), [agent.id, onToggleSelect]);
  const handleEdit = useCallback(() => onEdit(agent), [agent, onEdit]);
  const handleDelete = useCallback(() => onDelete(agent.id), [agent.id, onDelete]);
  const isSuper = agent.tier === "super";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative rounded-2xl border transition hover:shadow-lg",
        density === "compact" ? "p-3" : "p-5",
        isSuper
          ? "border-amber-200/60 bg-gradient-to-br from-amber-50/50 to-[var(--kp-bg-alt)] hover:border-amber-300/80"
          : "border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] hover:border-[var(--kp-brand)]/30",
        selected && "border-[var(--kp-brand)]/50 bg-[var(--kp-brand-soft)]/30",
      )}
    >
      <div className={cn("flex items-start justify-between gap-3", density === "compact" ? "mb-2" : "mb-4")}>
        <div className="flex items-center gap-3">
          {/* 超级 Agent 不可批量选择（不可删除） */}
          {!isSuper && (
            <label className="flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={selected}
                onChange={handleToggle}
                className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand)] focus:ring-[var(--kp-brand)]"
              />
            </label>
          )}
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl",
              isSuper
                ? "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md shadow-amber-500/30"
                : agent.tier === "manager"
                  ? "bg-blue-100 text-blue-600"
                  : "bg-[var(--kp-bg-mute)]",
            )}
          >
            {isSuper ? <Crown className="h-5 w-5" /> : agent.tier === "manager" ? <ShieldCheck className="h-5 w-5" /> : <AgentAvatar id={agent.id} name={agent.name} size={44} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[var(--kp-text-1)]">{agent.name}</h3>
              {isSuper ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                  <Lock className="h-2.5 w-2.5" />
                  超级 · 受保护
                </span>
              ) : agent.tier === "manager" ? (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">管理</span>
              ) : null}
              {agent.status === "deleted" && (
                <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] text-gray-500">已删除</span>
              )}
              {agent.status === "dormant" && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-400">休眠</span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]">
                <Cpu className="h-2.5 w-2.5" />
                {agent.model}
              </span>
              {(() => {
                const hb = agent.heartbeat as {
                  enabled?: boolean;
                  cron?: string;
                  lastRunStatus?: string | null;
                  consecutiveFailures?: number;
                } | null;
                if (!hb?.enabled) return null;
                const failed = (hb.consecutiveFailures ?? 0) > 0;
                return (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
                      failed ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600",
                    )}
                    title={`心跳 ${hb.cron ?? ""}${hb.lastRunStatus ? ` · 上次: ${hb.lastRunStatus}` : ""}`}
                  >
                    <HeartPulse className="h-2.5 w-2.5" />
                    {failed ? `心跳失败×${hb.consecutiveFailures}` : "心跳"}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      <p className={cn("min-h-[36px] text-xs leading-relaxed text-[var(--kp-text-3)]", density === "compact" ? "mb-2" : "mb-4")}>{agent.description || "暂无描述"}</p>

      {/* Workspace 归属 */}
      {agent.workspaceId && (
        <div className={cn("flex items-center gap-1.5 text-[10px] text-[var(--kp-text-3)]", density === "compact" ? "mb-1.5" : "mb-3")}>
          <Folder className="h-3 w-3" />
          <span>Workspace: {agent.workspaceId.slice(0, 8)}…</span>
        </div>
      )}
      {isSuper && (
        <div className={cn("flex items-center gap-1.5 text-[10px] text-amber-600", density === "compact" ? "mb-1.5" : "mb-3")}>
          <Crown className="h-3 w-3" />
          <span>全局超级 Agent · 不属于任何 Workspace</span>
        </div>
      )}

      <div className={cn("space-y-1 border-t border-[var(--kp-divider)] pt-3", density === "compact" ? "mb-2" : "mb-4")}>
        <AgentToolSummaryCard tools={agent.tools ?? []} />
      </div>

      <div className="flex gap-2">
        <Link
          href={`/chat?agentId=${agent.id}`}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 rounded-xl bg-[var(--kp-brand-deep)] py-2 text-xs font-medium text-white transition hover:opacity-90",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          对话
        </Link>
        <button
          type="button"
          onClick={handleEdit}
          className="rounded-xl border border-[var(--kp-divider)] px-3 py-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
        >
          配置
        </button>
        {/* 超级 Agent 不可删除 */}
        {!isSuper && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-xl px-2 py-2 text-red-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
});

export default function AgentsPage() {
  const { useList, useCreate, useUpdate, useDelete } = useAgent();
  const { density } = useCardDensity();
  const utils = trpc.useUtils();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const keyword = useDebouncedValue(searchInput.trim(), 300);
  const [tier, setTier] = useState<"" | "super" | "manager" | "sub">("");
  const [status, setStatus] = useState<"" | "active" | "idle" | "dormant" | "deleted">("");
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  // 编辑时保留心跳运行历史（lastRunAt/lastRunStatus/consecutiveFailures），保存不清零
  const [heartbeatMeta, setHeartbeatMeta] = useState<{
    lastRunAt: string | null;
    lastRunStatus: string | null;
    consecutiveFailures: number;
  }>({ lastRunAt: null, lastRunStatus: null, consecutiveFailures: 0 });

  const listInput = useMemo(
    () => ({ page, pageSize: 12, keyword: keyword || undefined, tier: tier || undefined, status: status || undefined }),
    [page, keyword, tier, status],
  );
  const { data, isLoading, refetch } = useList(listInput);

  const sortedItems = useMemo(
    () => [...(data?.items ?? [])].sort((a: Agent, b: Agent) => (TIER_RANK[a.tier ?? "sub"] ?? 2) - (TIER_RANK[b.tier ?? "sub"] ?? 2)),
    [data?.items],
  );

  const editingAgent = useMemo(() => sortedItems.find((a: Agent) => a.id === editingId), [sortedItems, editingId]);
  const isEditingSuper = editingAgent?.tier === "super";

  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const deleteMutation = useDelete();
  const bulkDeleteMutation = trpc.agent.bulkDelete.useMutation({
    onSuccess: () => {
      void utils.agent.list.invalidate();
      setSelectedIds(new Set());
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setView("edit");
  };

  const openEdit = useCallback((agent: Agent) => {
    setEditingId(agent.id);
    const hb = agent.heartbeat as {
      enabled?: boolean;
      cron?: string;
      goal?: string;
      lastRunAt?: string | null;
      lastRunStatus?: string | null;
      consecutiveFailures?: number;
    } | null;
    setHeartbeatMeta({
      lastRunAt: hb?.lastRunAt ?? null,
      lastRunStatus: hb?.lastRunStatus ?? null,
      consecutiveFailures: hb?.consecutiveFailures ?? 0,
    });
    setForm({
      name: agent.name,
      description: agent.description ?? "",
      model: agent.model,
      systemPrompt: agent.systemPrompt ?? "",
      tools: materializeAgentTools(agent.tools ?? []),
      heartbeatEnabled: hb?.enabled ?? false,
      heartbeatCron: hb?.cron ?? "0 9 * * *",
      heartbeatGoal: hb?.goal ?? "",
    });
    setView("edit");
  }, []);

  const handleSave = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      model: form.model,
      systemPrompt: form.systemPrompt,
      tools: materializeAgentTools(form.tools),
      heartbeat: {
        enabled: form.heartbeatEnabled,
        cron: form.heartbeatCron,
        goal: form.heartbeatGoal,
        // 保留运行历史，不因编辑而清零
        lastRunAt: heartbeatMeta.lastRunAt,
        lastRunStatus: heartbeatMeta.lastRunStatus,
        consecutiveFailures: heartbeatMeta.consecutiveFailures,
      },
    };
    if (!payload.name) return;

    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setView("list");
    void refetch();
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
      if (editingId === deleteId) setView("list");
    }
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === sortedItems.length) return new Set();
      return new Set(sortedItems.map((a) => a.id));
    });
  }, [sortedItems]);

  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setTier("");
    setStatus("");
    setPage(1);
    clearSelection();
  };

  const activeFiltersCount = Number(!!searchInput) + Number(!!tier) + Number(!!status);

  if (view === "edit") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
        <button
          type="button"
          onClick={() => setView("list")}
          className="mb-6 flex items-center gap-1 text-sm text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回档案馆
        </button>

        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)]">{editingId ? "编辑 Agent" : "新建 Agent"}</h1>
            <p className="mt-1 text-sm text-[var(--kp-text-3)]">
              配置模型、System Prompt 与工具授权。Chat 页右侧设置可会话级覆盖 Prompt。
            </p>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="assistant" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">描述</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Agent 职责简介"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">默认模型</label>
              <KpSelect
                value={form.model}
                onChange={(model) => setForm({ ...form, model })}
                options={modelOptions(form.model)}
                className="w-full"
                aria-label="默认模型"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                rows={8}
                className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                placeholder="定义 Agent 角色与行为。留空则仅依赖模型默认能力。"
              />
              {!form.systemPrompt.trim() && (
                <p className="mt-1.5 text-[11px] text-[var(--kp-text-3)]">当前为空。可在下方 Markdown 源文件或此处填写系统提示词。</p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-[var(--kp-text-3)]">工具授权</label>
              <AgentToolsEditor tools={form.tools} onChange={(tools) => setForm({ ...form, tools })} />
            </div>
            {/* 心跳配置（#4）：定时自主运行 */}
            <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HeartPulse className="h-4 w-4 text-[var(--kp-brand)]" />
                  <span className="text-xs font-medium text-[var(--kp-text-1)]">心跳（定时自主运行）</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.heartbeatEnabled}
                  onClick={() => setForm({ ...form, heartbeatEnabled: !form.heartbeatEnabled })}
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    form.heartbeatEnabled ? "bg-[var(--kp-brand)]" : "bg-[var(--kp-bg-mute)]",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                      form.heartbeatEnabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
              {form.heartbeatEnabled && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--kp-text-3)]">触发频率</label>
                    <KpSelect
                      value={HEARTBEAT_CRON_PRESETS.some((p) => p.value === form.heartbeatCron) ? form.heartbeatCron : "custom"}
                      onChange={(v) => v !== "custom" && setForm({ ...form, heartbeatCron: v })}
                      options={[
                        ...HEARTBEAT_CRON_PRESETS,
                        ...(HEARTBEAT_CRON_PRESETS.some((p) => p.value === form.heartbeatCron)
                          ? []
                          : [{ value: "custom", label: `自定义（${form.heartbeatCron}）` }]),
                      ]}
                      className="w-full"
                      aria-label="心跳频率"
                    />
                    <Input
                      value={form.heartbeatCron}
                      onChange={(e) => setForm({ ...form, heartbeatCron: e.target.value })}
                      placeholder="cron 表达式，如 0 9 * * *"
                      className="mt-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--kp-text-3)]">心跳目标（触发时发给 Agent 的任务）</label>
                    <textarea
                      value={form.heartbeatGoal}
                      onChange={(e) => setForm({ ...form, heartbeatGoal: e.target.value })}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                      placeholder="例：检查信息源更新并整理新文章"
                    />
                  </div>
                  {heartbeatMeta.lastRunAt && (
                    <p className="text-[11px] text-[var(--kp-text-3)]">
                      上次运行：{new Date(heartbeatMeta.lastRunAt).toLocaleString("zh-CN")} ·{" "}
                      {heartbeatMeta.lastRunStatus === "success" ? "成功" : heartbeatMeta.lastRunStatus ?? "未知"}
                      {heartbeatMeta.consecutiveFailures > 0 && ` · 连续失败 ${heartbeatMeta.consecutiveFailures} 次`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={() => void handleSave()} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingId ? "保存修改" : "创建 Agent"}
            </Button>
            {editingId && (
              <span
                className={cn(isEditingSuper && "cursor-not-allowed")}
                title={isEditingSuper ? "超级 Agent 不可删除" : undefined}
              >
                <Button
                  variant="destructive"
                  onClick={() => setDeleteId(editingId)}
                  disabled={isEditingSuper}
                  className="disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  删除
                </Button>
              </span>
            )}
          </div>
        </div>

        <ConfirmDialog
          isOpen={deleteId !== null}
          title="删除 Agent"
          description="确定删除此 Agent？关联配置将不可恢复。"
          isDestructive
          confirmLabel="确认删除"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-5">
      {/* UX #3：compact header——去掉整屏渐变 banner，标题与新建按钮同行，卡片直接可见 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--kp-text-1)]">我的 Agents</h1>
            <p className="text-xs text-[var(--kp-text-3)]">选择一个 Agent 开始对话，或配置模型、Prompt 与工具授权</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CardDensityToggle />
          <Button onClick={openCreate} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" />
            新建 Agent
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 text-xs text-[var(--kp-text-2)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
        <div>
          <span className="font-medium text-[var(--kp-text-1)]">心跳状态：</span>
          卡片上的心跳徽章表示该 Agent 是否按 cron 自主运行。绿色=正常，红色=连续失败，无徽章=未启用。
          定时任务去
          <Link href="/tasks" className="mx-1 text-[var(--kp-brand-dark)] hover:underline">/tasks</Link>，
          运行记录去
          <Link href="/runs" className="mx-1 text-[var(--kp-brand-dark)] hover:underline">/runs</Link>。
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
            <Input
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); clearSelection(); }}
              onKeyDown={(e) => e.key === "Enter" && setSearchInput(e.currentTarget.value.trim())}
              placeholder="搜索 Agent 名称…"
              className="pl-9"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <KpSelect
            value={tier}
            onChange={(v) => { setTier(v as typeof tier); setPage(1); clearSelection(); }}
            options={TIER_OPTIONS}
            className="w-36"
            aria-label="层级筛选"
          />
          <KpSelect
            value={status}
            onChange={(v) => { setStatus(v as typeof status); setPage(1); clearSelection(); }}
            options={STATUS_OPTIONS}
            className="w-32"
            aria-label="状态筛选"
          />
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--kp-divider)] px-2.5 py-1.5 text-xs text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            >
              <X className="h-3 w-3" />
              清空筛选
            </button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2"
          >
            <span className="text-xs text-[var(--kp-text-3)]">已选 {selectedIds.size} 项</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteId("__bulk__")}
              disabled={isBulkDeleting}
              className="gap-1"
            >
              <Trash2 className="h-4 w-4" />
              批量删除
            </Button>
          </motion.div>
        )}
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items?.length ? (
        <EmptyState
          title="暂无 Agent"
          description={activeFiltersCount > 0 ? "当前筛选条件下没有匹配结果，尝试调整筛选。" : "创建第一个 Agent，然后在 Chat 页开始对话。"}
          actionLabel={activeFiltersCount > 0 ? "清空筛选" : "新建 Agent"}
          onAction={activeFiltersCount > 0 ? clearFilters : openCreate}
        />
      ) : (
        <>
          <div className="flex items-center gap-2 px-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--kp-text-3)]">
              <input
                type="checkbox"
                checked={selectedIds.size === sortedItems.length && sortedItems.length > 0}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand)] focus:ring-[var(--kp-brand)]"
              />
              全选本页
            </label>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {sortedItems.map((agent: Agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={selectedIds.has(agent.id)}
                density={density}
                onToggleSelect={toggleSelect}
                onEdit={openEdit}
                onDelete={setDeleteId}
              />
            ))}
          </div>

          {data && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={(p) => { setPage(p); clearSelection(); }}
            />
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null && deleteId !== "__bulk__"}
        title="删除 Agent"
        description="确定删除此 Agent？此操作不可撤销。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        isOpen={deleteId === "__bulk__"}
        title="批量删除 Agent"
        description={`确定删除选中的 ${selectedIds.size} 个 Agent？此操作不可撤销。`}
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmBulkDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
