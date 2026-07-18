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
import { CHAT_MODELS, DEFAULT_LLM_MODEL, materializeAgentTools } from "@knowpilot/shared";
import { useAgent, useWorkspace, useCardDensity, type CardDensity } from "@/lib/hooks";
import {
  EmptyState,
  KpSelect,
  LoadingState,
  ConfirmDialog,
  Pagination,
  CardDensityToggle,
  AdminPage,
  AdminFormShell,
} from "@/components/shared";
import { AgentToolsEditor, AgentToolSummaryCard } from "@/components/AgentToolsEditor";
import { AgentAvatar } from "@/components/agentAvatar";
import { AssistantDriftBanner } from "@/components/assistantDriftBanner";
import { AgentLoopContractPanel } from "@/components/agentLoopContractPanel";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { describeCron, describeCronOption } from "@/lib/cronDescribe";

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
  /** 空 = 使用默认 model */
  heartbeatModel: string;
};

/** 心跳 cron 预设 */
const HEARTBEAT_CRON_PRESETS = [
  { value: "0 9 * * *", label: "每天 9:00" },
  { value: "0 0 * * *", label: "每天 0:00" },
  { value: "0 */6 * * *", label: "每 6 小时" },
  { value: "0 */12 * * *", label: "每 12 小时" },
  { value: "0 9 * * 1", label: "每周一 9:00" },
  { value: "*/30 * * * *", label: "每 30 分钟" },
];

function formatHeartbeatCron(cron: string | undefined | null): string {
  if (!cron) return "未设置";
  return HEARTBEAT_CRON_PRESETS.find((p) => p.value === cron)?.label ?? describeCron(cron);
}

function formatHeartbeatLastRun(iso: string | null | undefined): string {
  if (!iso) return "尚未运行";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

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
  "native:async_task_cancel",
  "native:sleep",
  "native:git_status",
  "skill:*",
  "mcp:filesystem",
];

const EMPTY_FORM: AgentForm = {
  name: "",
  description: "",
  model: DEFAULT_LLM_MODEL,
  systemPrompt: "你是 KnowPilot 智能助手，擅长知识管理与 Markdown 写作。",
  tools: [...DEFAULT_AGENT_TOOLS],
  heartbeatEnabled: false,
  heartbeatCron: "0 9 * * *",
  heartbeatGoal: "",
  heartbeatModel: "",
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
  workspaceName,
  onToggleSelect,
  onEdit,
  onDelete,
  onResumeHeartbeat,
  resumePending,
}: {
  agent: Agent;
  selected: boolean;
  density: CardDensity;
  workspaceName?: string | null;
  onToggleSelect: (id: string) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (id: string) => void;
  onResumeHeartbeat?: (id: string) => void;
  resumePending?: boolean;
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
                className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand-deep)] focus:ring-[var(--kp-brand)]"
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
            </div>
          </div>
        </div>
      </div>

      <p className={cn("min-h-[36px] text-xs leading-relaxed text-[var(--kp-text-3)]", density === "compact" ? "mb-2" : "mb-4")}>{agent.description || "暂无描述"}</p>

      {/* Workspace 归属 */}
      {agent.workspaceId && (
        <div className={cn("flex items-center gap-1.5 text-[10px] text-[var(--kp-text-3)]", density === "compact" ? "mb-1.5" : "mb-3")}>
          <Folder className="h-3 w-3" />
          <span>Workspace: {workspaceName || "未命名空间"}</span>
        </div>
      )}
      {isSuper && (
        <div className={cn("flex items-center gap-1.5 text-[10px] text-amber-600", density === "compact" ? "mb-1.5" : "mb-3")}>
          <Crown className="h-3 w-3" />
          <span>全局超级 Agent · 不属于任何 Workspace</span>
        </div>
      )}

      {(() => {
        const hb = agent.heartbeat;
        if (!hb?.enabled) return null;
        const failed = (hb.consecutiveFailures ?? 0) > 0;
        const suspended = !!agent.heartbeatSuspendedAt;
        return (
          <div
            className={cn(
              "rounded-xl border px-3 py-2.5 text-[11px]",
              density === "compact" ? "mb-2" : "mb-3",
              suspended
                ? "border-amber-200 bg-amber-50/80 text-amber-900"
                : failed
                  ? "border-red-200 bg-red-50/80 text-red-800"
                  : "border-emerald-200/80 bg-emerald-50/60 text-emerald-900",
            )}
            data-testid="agent-heartbeat-summary"
          >
            <div className="mb-1 flex flex-wrap items-center gap-1.5 font-medium">
              <HeartPulse className="h-3.5 w-3.5 shrink-0" />
              <span>心跳已开启</span>
              {suspended && (
                <span className="rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[9px] font-semibold">
                  已熔断暂停
                </span>
              )}
              {failed && !suspended && (
                <span className="rounded-full bg-red-200/80 px-1.5 py-0.5 text-[9px] font-semibold">
                  连续失败 ×{hb.consecutiveFailures}
                </span>
              )}
            </div>
            <div className="space-y-0.5 text-[10px] leading-relaxed opacity-90">
              <div>
                <span className="text-[var(--kp-text-3)]">频率 </span>
                {formatHeartbeatCron(hb.cron)}
                <span className="ml-1 font-mono text-[9px] opacity-70">({hb.cron})</span>
              </div>
              {agent.heartbeatModel && (
                <div>
                  <span className="text-[var(--kp-text-3)]">心跳模型 </span>
                  {agent.heartbeatModel}
                </div>
              )}
              {hb.goal?.trim() && (
                <div className="truncate" title={hb.goal}>
                  <span className="text-[var(--kp-text-3)]">目标 </span>
                  {hb.goal.trim()}
                </div>
              )}
              <div>
                <span className="text-[var(--kp-text-3)]">上次 </span>
                {formatHeartbeatLastRun(hb.lastRunAt)}
                {hb.lastRunStatus
                  ? ` · ${hb.lastRunStatus === "success" ? "成功" : hb.lastRunStatus}`
                  : ""}
              </div>
            </div>
            {suspended && onResumeHeartbeat && (
              <button
                type="button"
                disabled={resumePending}
                onClick={() => onResumeHeartbeat(agent.id)}
                className="mt-2 w-full rounded-lg bg-amber-700 px-2 py-1 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {resumePending ? "恢复中…" : "恢复心跳熔断"}
              </button>
            )}
          </div>
        );
      })()}

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
  const { useList: useWorkspaceList } = useWorkspace();
  const workspacesQuery = useWorkspaceList({ page: 1, pageSize: 100, status: "active" });
  const workspaceNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspacesQuery.data?.items ?? []) {
      m.set(w.id, w.name);
    }
    return m;
  }, [workspacesQuery.data?.items]);
  // W16d-3：默认 assistant 配置漂移横幅（drift 为空时组件渲染 null）
  const { data: driftStatus } = trpc.agent.driftStatus.useQuery(undefined, { staleTime: 60_000 });

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

  const openEdit = useCallback(
    (agent: Agent) => {
      setEditingId(agent.id);
      setView("edit");
      const apply = (row: Agent) => {
        const hb = row.heartbeat as {
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
          name: row.name,
          description: row.description ?? "",
          model: row.model,
          systemPrompt: row.systemPrompt ?? "",
          tools: materializeAgentTools(row.tools ?? []),
          heartbeatEnabled: hb?.enabled ?? false,
          heartbeatCron: hb?.cron ?? "0 9 * * *",
          heartbeatGoal: hb?.goal ?? "",
          heartbeatModel: row.heartbeatModel ?? "",
        });
      };
      apply(agent);
      // 列表裁剪了 systemPrompt，进编辑时拉全量
      void utils.agent
        .getById.fetch({ id: agent.id })
        .then((row) => apply(row as Agent))
        .catch(() => {});
    },
    [utils.agent.getById],
  );

  const resumeHeartbeatMut = trpc.agent.resumeHeartbeat.useMutation({
    onSuccess: () => void utils.agent.list.invalidate(),
  });

  const handleSave = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      model: form.model,
      systemPrompt: form.systemPrompt,
      tools: materializeAgentTools(form.tools),
      heartbeatModel: form.heartbeatModel.trim() || null,
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
      <AdminFormShell>
        <button
          type="button"
          onClick={() => setView("list")}
          className="flex items-center gap-1 text-sm text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回列表
        </button>

        <div>
          <h1 className="text-2xl font-bold text-[var(--kp-text-1)]">{editingId ? "编辑 Agent" : "新建 Agent"}</h1>
          <p className="mt-1 text-sm text-[var(--kp-text-3)]">
            配置模型、System Prompt、工具授权与心跳。Chat 页可会话级覆盖 Prompt。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 md:p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">名称</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="assistant" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">描述</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Agent 职责简介"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">默认模型</label>
                <KpSelect
                  value={form.model}
                  onChange={(model) => setForm({ ...form, model })}
                  options={modelOptions(form.model)}
                  className="w-full"
                  aria-label="默认模型"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                rows={10}
                className="w-full resize-y rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                placeholder="定义 Agent 角色与行为。留空则仅依赖模型默认能力。"
              />
              {!form.systemPrompt.trim() && (
                <p className="mt-1.5 text-[11px] text-[var(--kp-text-3)]">当前为空。可在 Markdown 源文件或此处填写系统提示词。</p>
              )}
            </div>
            {/* 心跳配置 */}
            <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <HeartPulse className="h-4 w-4 text-[var(--kp-brand-deep)]" />
                  <span className="text-xs font-medium text-[var(--kp-text-1)]">心跳（定时自主运行）</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      form.heartbeatEnabled
                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                        : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
                    )}
                  >
                    {form.heartbeatEnabled ? "已开启" : "已关闭"}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.heartbeatEnabled}
                  aria-label={form.heartbeatEnabled ? "关闭心跳" : "开启心跳"}
                  onClick={() => setForm({ ...form, heartbeatEnabled: !form.heartbeatEnabled })}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      setForm({ ...form, heartbeatEnabled: !form.heartbeatEnabled });
                    }
                  }}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2",
                    form.heartbeatEnabled
                      ? "bg-emerald-600"
                      : "bg-[var(--kp-bg-mute)] ring-1 ring-inset ring-[var(--kp-divider)]",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
                      form.heartbeatEnabled && "translate-x-5",
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
                          : [{ value: "custom", label: describeCronOption(form.heartbeatCron) }]),
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
                    <p className="mt-1 text-[10px] text-[var(--kp-text-3)]">
                      当前：{formatHeartbeatCron(form.heartbeatCron)}
                      {HEARTBEAT_CRON_PRESETS.every((p) => p.value !== form.heartbeatCron) &&
                        formatHeartbeatCron(form.heartbeatCron) !== form.heartbeatCron && (
                          <span className="ml-1 font-mono opacity-70">（{form.heartbeatCron}）</span>
                        )}
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--kp-text-3)]">心跳模型（可选）</label>
                    <KpSelect
                      value={form.heartbeatModel || "__default__"}
                      onChange={(v) =>
                        setForm({ ...form, heartbeatModel: v === "__default__" ? "" : v })
                      }
                      options={[
                        { value: "__default__", label: `与默认模型相同（${form.model}）` },
                        ...modelOptions(form.heartbeatModel || form.model).filter(
                          (o) => o.value !== "__default__",
                        ),
                      ]}
                      className="w-full"
                      aria-label="心跳模型"
                    />
                    <p className="mt-1 text-[10px] text-[var(--kp-text-3)]">
                      可用更便宜的模型跑定时巡检，省主对话配额。
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--kp-text-3)]">心跳目标（触发时发给 Agent 的任务）</label>
                    <textarea
                      value={form.heartbeatGoal}
                      onChange={(e) => setForm({ ...form, heartbeatGoal: e.target.value })}
                      rows={4}
                      className="w-full resize-y rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                      placeholder="例：检查信息源更新并整理新文章"
                    />
                  </div>
                  {(heartbeatMeta.lastRunAt || heartbeatMeta.consecutiveFailures > 0) && (
                    <p className="text-[11px] text-[var(--kp-text-3)]">
                      上次运行：{formatHeartbeatLastRun(heartbeatMeta.lastRunAt)} ·{" "}
                      {heartbeatMeta.lastRunStatus === "success" ? "成功" : heartbeatMeta.lastRunStatus ?? "未知"}
                      {heartbeatMeta.consecutiveFailures > 0 && ` · 连续失败 ${heartbeatMeta.consecutiveFailures} 次`}
                    </p>
                  )}
                  {editingId && <AgentLoopContractPanel agentId={editingId} />}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 md:p-6">
            <div>
              <label className="mb-2 block text-xs font-medium text-[var(--kp-text-3)]">工具授权</label>
              <AgentToolsEditor tools={form.tools} onChange={(tools) => setForm({ ...form, tools })} />
            </div>
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

        <ConfirmDialog
          isOpen={deleteId !== null}
          title="删除 Agent"
          description="确定删除此 Agent？关联配置将不可恢复。"
          isDestructive
          confirmLabel="确认删除"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      </AdminFormShell>
    );
  }

  return (
    <AdminPage>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--kp-text-1)]">我的 Agents</h1>
            <p className="text-xs text-[var(--kp-text-3)]">选择一个 Agent 开始对话，或配置模型、Prompt、工具与心跳</p>
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

      {driftStatus && (
        <AssistantDriftBanner
          agentName={driftStatus.agentName}
          drift={driftStatus.drift}
          migrationHint={driftStatus.migrationHint}
        />
      )}

      <div className="flex items-start gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 text-xs text-[var(--kp-text-2)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
        <div>
          <span className="font-medium text-[var(--kp-text-1)]">心跳：</span>
          卡片展示频率、目标与上次运行。配置在「配置」页；系统定时脚本见
          <Link href="/tasks" className="mx-1 text-[var(--kp-brand-deep)] hover:underline">/tasks</Link>
          ，运行记录见
          <Link href="/runs" className="mx-1 text-[var(--kp-brand-deep)] hover:underline">/runs</Link>
          。说明见
          <code className="mx-1 rounded bg-[var(--kp-bg-mute)] px-1 py-0.5">docs/development/scheduled-tasks-and-heartbeat.md</code>。
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
                className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand-deep)] focus:ring-[var(--kp-brand)]"
              />
              全选本页
            </label>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-5">
            {sortedItems.map((agent: Agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={selectedIds.has(agent.id)}
                density={density}
                workspaceName={agent.workspaceId ? workspaceNameById.get(agent.workspaceId) : null}
                onToggleSelect={toggleSelect}
                onEdit={openEdit}
                onDelete={setDeleteId}
                onResumeHeartbeat={(id) => resumeHeartbeatMut.mutate({ agentId: id })}
                resumePending={resumeHeartbeatMut.isPending}
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
    </AdminPage>
  );
}
