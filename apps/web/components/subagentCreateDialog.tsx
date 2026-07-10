"use client";

/**
 * 创建子 Agent 任务弹窗 — 支持两种模式：
 * 1. 选择现有 Agent 并指派任务（原 session.spawn）。
 * 2. 新建一个子 Agent（调用 agent.create，tier=sub），再用它启动任务。
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { Bot, Loader2, Sparkles, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { KpSelect } from "@/components/shared";
import { PRIMARY_CHAT_MODELS } from "@knowpilot/shared";

type CreateResult = {
  subagentSessionId?: string;
  status: "queued" | "running";
  jobId: string;
  taskLabel: string;
  model?: string;
};

const ASYNC_TOOL_NAMES = new Set([
  "native:async_task_run",
  "native:async_task_status",
  "native:async_task_wait",
  "native:async_task_cancel",
]);
const SUBAGENT_FORBIDDEN_TOOLS = new Set([
  "native:spawn_subagent",
  "native:agent_create_sub",
  "native:agent_update_sub",
  "native:agent_delete_sub",
  "native:agent_forward",
  "native:agent_send_message",
  "native:agent_report_back",
]);

function deriveSubagentTools(parentTools: string[] = []): string[] {
  const base = parentTools.filter((t) => !SUBAGENT_FORBIDDEN_TOOLS.has(t));
  for (const t of ASYNC_TOOL_NAMES) {
    if (!base.includes(t)) base.push(t);
  }
  return base;
}

export function SubagentCreateDialog({
  open,
  parentSessionId,
  parentAgentId,
  parentAgentTools,
  onClose,
  onCreated,
}: {
  open: boolean;
  parentSessionId?: string;
  parentAgentId?: string;
  parentAgentTools?: string[];
  onClose: () => void;
  onCreated?: (result: CreateResult) => void;
}) {
  const searchParams = useSearchParams();
  // 容错：props 未传入时从 URL 取当前 sessionId，避免弹窗打开后 parentSessionId 为空导致提交无响应
  const effectiveParentSessionId = parentSessionId || searchParams.get("sessionId") || undefined;
  const utils = trpc.useUtils();
  const agentsQuery = trpc.agent.list.useQuery({ page: 1, pageSize: 50 });
  const createAgentMut = trpc.agent.create.useMutation({
    onSuccess: (res) => {
      if (res.success && res.data?.id) {
        void utils.agent.list.invalidate();
        // 创建成功后继续用新 Agent 启动子 Agent 任务
        spawnWithAgent(res.data.id);
      }
    },
  });
  const spawnMut = trpc.session.spawn.useMutation({
    onSuccess: (data, variables) => {
      const taskLabel = variables.task.trim().slice(0, 60);
      // 乐观更新：子 Agent 卡片立即出现在左侧面板，无需等待轮询
      if (data.subagentSessionId) {
        utils.session.listChildren.setData(
          { parentSessionId: variables.parentSessionId, pageSize: 20 },
          (prev) => {
            if (!prev) return prev;
            const exists = prev.items.some((item) => item.id === data.subagentSessionId);
            if (exists) return prev;
            const optimisticItem = {
              id: data.subagentSessionId,
              title: taskLabel,
              status: data.status,
              taskDescription: taskLabel,
              model: variables.model || null,
              updatedAt: new Date(),
              createdAt: new Date(),
            } as (typeof prev.items)[number];
            return { ...prev, items: [optimisticItem, ...prev.items] };
          },
        );
      }
      void utils.session.list.invalidate();
      void utils.session.listChildren.invalidate();
      // 强制立即刷新子 Agent 列表，确保新卡片在面板中实时出现
      void utils.session.listChildren.refetch({ parentSessionId: variables.parentSessionId, pageSize: 20 });
      onCreated?.({
        subagentSessionId: data.subagentSessionId,
        status: data.status,
        jobId: data.jobId,
        taskLabel,
        model: variables.model || undefined,
      });
      resetAndClose();
    },
  });

  const agents = useMemo(() => agentsQuery.data?.items ?? [], [agentsQuery.data?.items]);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [agentId, setAgentId] = useState<string>("");
  const [task, setTask] = useState("");
  const [model, setModel] = useState<string>("");

  // 新建子 Agent 字段
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    if (open && !agentId && agents[0]) {
      // queueMicrotask 避免在 effect 同步阶段调用 setState
      queueMicrotask(() => setAgentId(agents[0].id));
    }
  }, [open, agents, agentId]);

  const resetAndClose = () => {
    setTask("");
    setModel("");
    setName("");
    setDescription("");
    setSystemPrompt("");
    setMode("existing");
    spawnMut.reset();
    createAgentMut.reset();
    onClose();
  };

  useEffect(() => {
    if (!open) {
      queueMicrotask(resetAndClose);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const spawnWithAgent = (targetAgentId: string) => {
    const trimmed = task.trim();
    if (!trimmed || !effectiveParentSessionId || !targetAgentId) return;
    spawnMut.mutate({
      parentSessionId: effectiveParentSessionId,
      agentId: targetAgentId,
      task: trimmed,
      model: model || undefined,
    });
  };

  const handleSubmit = () => {
    const trimmed = task.trim();
    if (!trimmed || !effectiveParentSessionId) return;
    if (mode === "existing") {
      if (!agentId) return;
      spawnWithAgent(agentId);
    } else {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      createAgentMut.mutate({
        name: trimmedName,
        description: description.trim() || undefined,
        model: model || undefined,
        systemPrompt: systemPrompt.trim(),
        // 子 Agent 继承父 Agent 工具（剔除派生/管理类），并确保拥有异步任务工具。
        tools: deriveSubagentTools(parentAgentTools),
        tier: "sub",
        parentId: parentAgentId,
        source: "ui:subagent_panel",
      });
    }
  };

  const isPending = spawnMut.isPending || createAgentMut.isPending;
  const canSubmit =
    task.trim() &&
    !!effectiveParentSessionId &&
    (mode === "existing" ? !!agentId : name.trim() && !isPending);

  const error = spawnMut.error?.message ?? createAgentMut.error?.message ?? null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-[460px] max-w-[92vw] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 shadow-xl"
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
                <Bot className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-bold text-[var(--kp-text-1)]">新建子 Agent 任务 [debug]</h2>
            </div>

            {/* 模式切换 */}
            <div className="mb-4 flex rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-1">
              <button
                type="button"
                onClick={() => setMode("existing")}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                  mode === "existing"
                    ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                    : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]",
                )}
              >
                选择现有 Agent
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                  mode === "new"
                    ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                    : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]",
                )}
              >
                新建子 Agent
              </button>
            </div>

            <div className="space-y-3">
              {mode === "existing" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--kp-text-2)]">Agent</label>
                  <KpSelect
                    value={agentId}
                    onChange={setAgentId}
                    options={agents.map((a) => ({ value: a.id, label: a.name }))}
                    variant="capsule"
                    size="sm"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--kp-text-2)]">名称</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="例如：Research-Helper"
                      className="w-full rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-xs text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--kp-text-2)]">描述（可选）</label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="一句话说明这个子 Agent 的职责"
                      className="w-full rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-xs text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--kp-text-2)]">System Prompt</label>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={3}
                      placeholder="给子 Agent 的通用角色与约束"
                      className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--kp-text-2)]">任务描述</label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="例如：搜索 KnowPilot 并整理成 200 字摘要"
                  className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--kp-text-2)]">模型（可选）</label>
                <KpSelect
                  value={model}
                  onChange={setModel}
                  options={PRIMARY_CHAT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
                  variant="capsule"
                  size="sm"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">
                  {error}
                </p>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "gap-1.5 text-xs",
                  (!canSubmit || isPending) && "opacity-60 cursor-not-allowed",
                )}
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : mode === "new" ? (
                  <Plus className="h-3.5 w-3.5" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {mode === "new" ? "创建并启动" : "启动任务"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
