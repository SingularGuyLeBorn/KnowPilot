"use client";

/**
 * WorkspaceSessionTree — 当前 Workspace 下的会话导航
 *
 * 两种模式：
 *   - main: 显示当前 Workspace 的主 Agent（super/manager）及其所有 sessions，按时间分组
 *   - sub:  显示当前 Workspace 下所有子 Agent，每个子 Agent 绑定其唯一/最新 session
 */

import { useCallback, useMemo } from "react";
import { Bot, Crown, Loader2, Pin, ShieldCheck, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn, formatRelativeTime, groupBySessionDate } from "@/lib/utils";
import type { ChatSession } from "@knowpilot/shared";

interface WorkspaceAgent {
  id: string;
  name: string;
  autoName?: string | null;
  tier: string;
  status: string;
  model: string;
  workspaceId: string | null;
}

interface WorkspaceTreeProps {
  currentWorkspaceId: string | null;
  effectiveSessionId: string | null;
  /** 当前激活的 Agent ID；mode="sub" 时直接按 Agent 高亮，避免依赖 session 列表加载时机 */
  effectiveAgentId?: string | null;
  /** 由父组件传入已查的 Agent 列表 */
  agents: WorkspaceAgent[];
  onSelectSession: (id: string) => void;
  onHoverSession?: (id: string) => void;
  onHoverSessionEnd?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onNewChat: () => void;
  searchQuery: string;
  /** 主 Agent / 子 Agent 两种视图 */
  mode: "main" | "sub";
}

export function WorkspaceTree({
  currentWorkspaceId,
  effectiveSessionId,
  effectiveAgentId,
  agents,
  onSelectSession,
  onHoverSession,
  onHoverSessionEnd,
  onDeleteSession,
  onNewChat,
  searchQuery,
  mode,
}: WorkspaceTreeProps) {
  const searchLower = searchQuery.trim().toLowerCase();

  const workspaceAgents = useMemo(() => {
    return agents.filter((a) => a.workspaceId === currentWorkspaceId && a.status !== "deleted");
  }, [agents, currentWorkspaceId]);

  const mainAgents = useMemo(() => {
    const tierRank: Record<string, number> = { super: 0, manager: 1, sub: 99 };
    return workspaceAgents
      .filter((a) => a.tier === "super" || a.tier === "manager")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || (tierRank[a.tier] ?? 99) - (tierRank[b.tier] ?? 99));
  }, [workspaceAgents]);

  const subAgents = useMemo(() => {
    return workspaceAgents
      .filter((a) => a.tier === "sub")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [workspaceAgents]);

  const mainAgentId = mainAgents[0]?.id;
  const subAgentIds = useMemo(() => subAgents.map((a) => a.id), [subAgents]);

  const mainSessionsQuery = trpc.session.list.useQuery(
    { page: 1, pageSize: 100, agentId: mainAgentId },
    { enabled: mode === "main" && !!mainAgentId },
  );

  const subSessionsQuery = trpc.session.list.useQuery(
    { page: 1, pageSize: 100, agentIds: subAgentIds },
    { enabled: mode === "sub" && subAgentIds.length > 0 },
  );

  const mainGroupedSessions = useMemo(() => {
    const sessions = (mainSessionsQuery.data?.items ?? []) as ChatSession[];
    const filtered = searchLower
      ? sessions.filter((s) => s.title.toLowerCase().includes(searchLower))
      : sessions;
    return groupBySessionDate(filtered);
  }, [mainSessionsQuery.data, searchLower]);

  const subSessionsByAgent = useMemo(() => {
    const map = new Map<string, ChatSession[]>();
    for (const s of (subSessionsQuery.data?.items ?? []) as ChatSession[]) {
      const agentId = s.agentId ?? "";
      const list = map.get(agentId) ?? [];
      list.push(s);
      map.set(agentId, list);
    }
    return map;
  }, [subSessionsQuery.data]);

  const getSubAgentSession = useCallback(
    (agentId: string) => {
      const sessions = subSessionsByAgent.get(agentId) ?? [];
      if (sessions.length === 0) return undefined;
      // 当前 session 属于该子 Agent 时优先高亮当前 session
      const current = sessions.find((s) => s.id === effectiveSessionId);
      if (current) return current;
      return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    },
    [subSessionsByAgent, effectiveSessionId],
  );

  const isSubAgentActive = (agentId: string) => {
    if (effectiveAgentId && effectiveAgentId === agentId) return true;
    const sessions = subSessionsByAgent.get(agentId) ?? [];
    return sessions.some((s) => s.id === effectiveSessionId);
  };

  const filteredSubAgents = useMemo(() => {
    if (!searchLower) return subAgents;
    return subAgents.filter((a) => {
      const session = getSubAgentSession(a.id);
      return (
        a.name.toLowerCase().includes(searchLower) ||
        session?.title.toLowerCase().includes(searchLower)
      );
    });
  }, [subAgents, searchLower, getSubAgentSession]);

  if (!currentWorkspaceId) {
    return (
      <p className="px-2 py-4 text-center text-xs text-[var(--kp-text-3)]">
        请先选择一个 Workspace
      </p>
    );
  }

  if (mode === "main") {
    if (mainAgents.length === 0) {
      return (
        <div className="space-y-2 px-2 py-4 text-center">
          <p className="text-xs text-[var(--kp-text-3)]">当前 Workspace 暂无主 Agent</p>
          <button
            type="button"
            onClick={onNewChat}
            className="text-xs text-[var(--kp-brand)] hover:underline"
          >
            新建对话
          </button>
        </div>
      );
    }

    const mainAgent = mainAgents[0];
    const isLoading = mainSessionsQuery.isLoading;

    return (
      <div className="space-y-2" data-testid="workspace-tree-main">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <AgentIcon tier={mainAgent.tier} className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--kp-text-1)]">
            {mainAgent.name}
          </span>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--kp-text-3)]" />
          </div>
        )}

        {!isLoading && mainGroupedSessions.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-[var(--kp-text-3)]">
            {searchLower ? "无匹配会话" : "暂无对话"}
          </p>
        )}

        {mainGroupedSessions.map((group) => (
          <div key={group.key} className="mb-2">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={effectiveSessionId === s.id}
                  onSelect={() => onSelectSession(s.id)}
                  onHover={() => onHoverSession?.(s.id)}
                  onHoverEnd={() => onHoverSessionEnd?.(s.id)}
                  onDelete={onDeleteSession ? () => onDeleteSession(s.id) : undefined}
                  data-testid="session-list-item"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // mode === "sub"
  if (filteredSubAgents.length === 0) {
    return (
      <div className="space-y-2 px-2 py-4 text-center">
        <p className="text-xs text-[var(--kp-text-3)]">
          {searchLower ? "无匹配子 Agent" : "当前 Workspace 暂无子 Agent"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5" data-testid="workspace-tree-sub">
      {filteredSubAgents.map((agent) => {
        const session = getSubAgentSession(agent.id);
        const active = isSubAgentActive(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            disabled={!session}
            data-testid="subagent-item"
            onClick={() => session && onSelectSession(session.id)}
            onMouseEnter={() => session && onHoverSession?.(session.id)}
            onMouseLeave={() => session && onHoverSessionEnd?.(session.id)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition",
              active
                ? "bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-dark)]"
                : "text-[var(--kp-text-1)] hover:bg-[var(--kp-bg-mute)]",
              !session && "opacity-60",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
              <span className="min-w-0 flex-1 truncate">{agent.autoName || agent.name}</span>
              {agent.status === "dormant" && (
                <span className="text-[9px] text-[var(--kp-text-3)]">休眠</span>
              )}
            </div>
            {session && (
              <div className="flex items-center gap-1.5 pl-5 text-[11px] text-[var(--kp-text-2)]">
                {session.isMainSession && <Pin className="h-2.5 w-2.5 shrink-0 text-[var(--kp-brand)]" />}
                <span className="min-w-0 flex-1 truncate">{session.autoName || session.title}</span>
                <span className="ml-auto shrink-0 text-[9px] text-[var(--kp-text-3)]">
                  {formatRelativeTime(session.updatedAt)}
                </span>
                {onDeleteSession && (
                  <span
                    role="button"
                    tabIndex={0}
                    title="删除会话"
                    className="rounded p-0.5 text-[var(--kp-text-3)] hover:bg-red-50 hover:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function AgentIcon({ tier, className }: { tier: string; className?: string }) {
  if (tier === "super") return <Crown className={cn("text-amber-500", className)} />;
  if (tier === "manager") return <ShieldCheck className={cn("text-blue-500", className)} />;
  return <Bot className={cn("text-[var(--kp-brand)]", className)} />;
}

function SessionRow({
  session,
  active,
  onSelect,
  onHover,
  onHoverEnd,
  onDelete,
  "data-testid": dataTestId,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
  onDelete?: () => void;
  "data-testid"?: string;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] transition",
        active
          ? "bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-dark)]"
          : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
      )}
    >
      <button
        type="button"
        data-testid={dataTestId}
        onClick={onSelect}
        onMouseEnter={onHover}
        onMouseLeave={onHoverEnd}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {session.isMainSession && <Pin className="h-2.5 w-2.5 shrink-0 text-[var(--kp-brand)]" />}
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        <span className="ml-auto shrink-0 text-[9px] text-[var(--kp-text-3)]">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          title="删除会话"
          className="shrink-0 rounded p-0.5 text-[var(--kp-text-3)] opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
