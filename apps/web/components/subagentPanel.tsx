"use client";

/**
 * 子 Agent 面板 — 左侧栏显示当前主 Agent 的子 Agent 实体（Agent tier=sub）
 * 与异步任务面板分离：子 Agent 是 Agent 实体，异步任务由 AsyncTaskPanel 展示。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, ChevronRight, Plus, Trash2, ExternalLink, Eye, Play } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared";
import type { Agent } from "@knowpilot/shared";

interface SubagentAgentBrief {
  id: string;
  name: string;
  autoName?: string | null;
  description?: string | null;
  model: string;
  status: string;
  source?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: "bg-green-500",
  idle: "bg-blue-400",
  dormant: "bg-amber-400",
  deleted: "bg-gray-400",
};

const STATUS_LABEL: Record<string, string> = {
  active: "活跃",
  idle: "空闲",
  dormant: "休眠",
  deleted: "已删除",
};

const SOURCE_LABEL: Record<string, string> = {
  "ui:subagent_panel": "手动创建",
  ui: "手动创建",
  manual: "手动创建",
  "native_tool:agent_create_sub": "工具创建",
  "native_tool:agent_create": "工具创建",
  tool: "工具创建",
  heartbeat: "心跳",
  import: "导入",
};

function formatSource(source?: string | null): string {
  if (!source) return "未知来源";
  return SOURCE_LABEL[source] ?? source;
}

function SubagentAgentCard({
  agent,
  parentSessionId,
  subagentSessionId,
  onRefresh,
  onRunTask,
}: {
  agent: SubagentAgentBrief;
  parentSessionId?: string;
  subagentSessionId?: string;
  onRefresh: () => void;
  onRunTask?: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = trpc.agent.delete.useMutation({ onSuccess: onRefresh });
  const utils = trpc.useUtils();

  const statusColor = STATUS_COLOR[agent.status] ?? "bg-gray-400";

  return (
    <div
      data-testid="subagent-card"
      className="rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-2 text-xs shadow-sm transition-colors hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        aria-label={`子 Agent ${agent.autoName || agent.name}`}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor)} title={STATUS_LABEL[agent.status] ?? agent.status} />
        <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--kp-text-1)]">{agent.autoName || agent.name}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 border-t border-[var(--kp-divider-light)] pt-2">
              {agent.description && (
                <p className="line-clamp-3 text-[11px] leading-relaxed text-[var(--kp-text-3)]">{agent.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--kp-text-3)]">
                <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5">{STATUS_LABEL[agent.status] ?? agent.status}</span>
                <span className="rounded-full bg-[var(--kp-brand-soft)] px-2 py-0.5 text-[var(--kp-brand-dark)]">{formatSource(agent.source)}</span>
                <span className="truncate">{agent.model}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {parentSessionId && onRunTask && (
                  <button
                    type="button"
                    onClick={() => onRunTask(agent.id)}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <Play className="h-3 w-3" /> 启动任务
                  </button>
                )}
                {subagentSessionId ? (
                  <a
                    href={`/chat?sessionId=${subagentSessionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <Eye className="h-3 w-3" /> 查看任务进行
                  </a>
                ) : (
                  <span className="inline-flex h-6 items-center gap-1 px-2 text-[10px] text-[var(--kp-text-3)]">
                    <Eye className="h-3 w-3" /> 暂无进行中的任务会话
                  </span>
                )}
                <Link
                  href={`/agents`}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                >
                  <ExternalLink className="h-3 w-3" /> 去管理页
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px] text-red-500 hover:text-red-600")}
                >
                  <Trash2 className="h-3 w-3" /> 删除
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        isOpen={confirmDelete}
        title="删除子 Agent"
        description={`确定删除「${agent.name}」？删除后无法恢复。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          deleteMut.mutate({ id: agent.id });
          void utils.agent.list.invalidate();
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function SubagentPanel({
  parentAgentId,
  parentSessionId,
  onCreate,
  onRunTask,
}: {
  parentAgentId?: string;
  parentSessionId?: string;
  onCreate?: () => void;
  onRunTask?: (agentId: string) => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.agent.list.useQuery(
    { page: 1, pageSize: 50, parentId: parentAgentId },
    {
      enabled: !!parentAgentId,
      // 推优先：子会话 SSE 会 invalidate；此处仅 focus 兜底
      refetchInterval: false,
      refetchOnWindowFocus: true,
    },
  );

  const childrenQuery = trpc.session.listChildren.useQuery(
    { parentSessionId: parentSessionId!, pageSize: 100 },
    {
      enabled: !!parentSessionId,
      refetchInterval: false,
      refetchOnWindowFocus: true,
    },
  );

  const items = useMemo(() => (query.data?.items as Agent[] | undefined) ?? [], [query.data?.items]);

  const sessionByAgentId = useMemo(() => {
    const map = new Map<string, { id: string; status: string }>();
    const childItems = (childrenQuery.data?.items as Array<{ id: string; agentId?: string | null; status?: string }> | undefined) ?? [];
    for (const s of childItems) {
      if (s.agentId && !map.has(s.agentId)) {
        map.set(s.agentId, { id: s.id, status: s.status ?? "unknown" });
      }
    }
    return map;
  }, [childrenQuery.data?.items]);

  const refresh = () => {
    void query.refetch();
    void utils.agent.list.invalidate();
    if (parentSessionId) {
      void utils.session.listChildren.invalidate({ parentSessionId });
    }
  };

  if (!parentAgentId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-[var(--kp-text-3)]">
        当前没有主 Agent，<br />无法查看子 Agent。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--kp-text-2)]">子 Agent · {items.length}</span>
        {onCreate && (
          <button
            type="button"
            data-testid="subagent-create-button"
            onClick={onCreate}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--kp-brand-soft)] px-2 py-1 text-[10px] font-medium text-[var(--kp-brand-dark)] transition hover:bg-[var(--kp-brand-light)]/30"
          >
            <Plus className="h-3 w-3" />
            新建
          </button>
        )}
      </div>
      {items.length === 0 && !query.isLoading && (
        <div className="rounded-lg border border-dashed border-[var(--kp-divider)] p-4 text-center text-xs text-[var(--kp-text-3)]">
          暂无子 Agent，点击右上角新建。
        </div>
      )}
      {items.map((agent) => {
        const session = sessionByAgentId.get(agent.id);
        return (
          <SubagentAgentCard
            key={agent.id}
            agent={agent as SubagentAgentBrief}
            parentSessionId={parentSessionId}
            subagentSessionId={session?.id}
            onRefresh={refresh}
            onRunTask={onRunTask}
          />
        );
      })}
    </div>
  );
}
