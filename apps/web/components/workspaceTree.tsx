"use client";

/**
 * WorkspaceTree — Swarm 模式左侧栏 Workspace → Agent → Session 三层树
 * (#33a 精细设计已确认)
 *
 * 结构：
 *   👑 超级 Agent（全局）
 *     └─ 主 session
 *     └─ 会话 2
 *   📁 技术博客 Workspace
 *     🛡️ 管理 Agent
 *       └─ 📌 主 session
 *       └─ 会话 2
 *     🤖 爬虫 Agent
 *       └─ 📌 主 session
 *   📁 已归档 Workspace（折叠）
 */

import { useState, useMemo } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Crown,
  FolderOpen,
  FolderArchive,
  Pin,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn, formatRelativeTime } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { ChatSession } from "@knowpilot/shared";

interface WorkspaceTreeProps {
  effectiveSessionId: string | null;
  onSelectSession: (id: string) => void;
  onSelectAgent: (agentId: string) => void;
  onNewChat: () => void;
  searchQuery: string;
}

export function WorkspaceTree({
  effectiveSessionId,
  onSelectSession,
  onSelectAgent,
  onNewChat,
  searchQuery,
}: WorkspaceTreeProps) {
  // 展开/折叠状态
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);

  // 拉取数据
  const workspacesQuery = trpc.workspace.list.useQuery({ page: 1, pageSize: 100, status: "active" });
  const archivedWorkspacesQuery = trpc.workspace.list.useQuery({ page: 1, pageSize: 100, status: "archived" });
  const agentsQuery = trpc.agent.list.useQuery({ page: 1, pageSize: 100 });
  const superAgents = useMemo(
    () => (agentsQuery.data?.items ?? []).filter((a) => a.tier === "super" && a.status !== "deleted"),
    [agentsQuery.data],
  );
  const managerAgents = useMemo(
    () => (agentsQuery.data?.items ?? []).filter((a) => a.tier === "manager" && a.status !== "deleted"),
    [agentsQuery.data],
  );
  const subAgents = useMemo(
    () => (agentsQuery.data?.items ?? []).filter((a) => a.tier === "sub" && a.status !== "deleted"),
    [agentsQuery.data],
  );

  const activeWorkspaces = workspacesQuery.data?.items ?? [];
  const archivedWorkspaces = archivedWorkspacesQuery.data?.items ?? [];

  const toggleWorkspace = (id: string) =>
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAgent = (id: string) =>
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 搜索过滤
  const searchLower = searchQuery.trim().toLowerCase();
  const matchesSearch = (text: string) => !searchLower || text.toLowerCase().includes(searchLower);

  return (
    <div className="space-y-1" data-testid="workspace-tree">
      {/* 新建对话按钮 */}
      <button
        type="button"
        onClick={onNewChat}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-full justify-start gap-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        新建对话
      </button>

      {/* 超级 Agent（全局，无 Workspace） */}
      {superAgents.map((agent) => (
        <AgentNode
          key={agent.id}
          agent={agent}
          expanded={expandedAgents.has(agent.id) || !!searchLower}
          onToggle={() => toggleAgent(agent.id)}
          effectiveSessionId={effectiveSessionId}
          onSelectSession={onSelectSession}
          onSelectAgent={onSelectAgent}
          searchLower={searchLower}
          matchesSearch={matchesSearch}
        />
      ))}

      {/* 活跃 Workspace 列表 */}
      {activeWorkspaces.map((ws) => {
        const wsManagers = managerAgents.filter((a) => a.workspaceId === ws.id);
        const wsSubs = subAgents.filter((a) => a.workspaceId === ws.id);
        const wsAgents = [...wsManagers, ...wsSubs];
        if (wsAgents.length === 0 && !matchesSearch(ws.name)) return null;

        const expanded = expandedWorkspaces.has(ws.id) || !!searchLower;
        return (
          <div key={ws.id}>
            <button
              type="button"
              onClick={() => toggleWorkspace(ws.id)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--kp-text-1)] transition hover:bg-[var(--kp-bg-mute)]"
            >
              {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--kp-text-3)]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--kp-text-3)]" />}
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="truncate">{ws.name}</span>
            </button>
            {expanded && (
              <div className="ml-3 space-y-0.5 border-l border-[var(--kp-divider-light)] pl-2">
                {wsAgents.map((agent) => (
                  <AgentNode
                    key={agent.id}
                    agent={agent}
                    expanded={expandedAgents.has(agent.id) || !!searchLower}
                    onToggle={() => toggleAgent(agent.id)}
                    effectiveSessionId={effectiveSessionId}
                    onSelectSession={onSelectSession}
                    onSelectAgent={onSelectAgent}
                    searchLower={searchLower}
                    matchesSearch={matchesSearch}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 已归档 Workspace（折叠区） */}
      {archivedWorkspaces.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)]"
          >
            {showArchived ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <FolderArchive className="h-3.5 w-3.5" />
            <span>已归档 ({archivedWorkspaces.length})</span>
          </button>
          {showArchived && (
            <div className="ml-3 space-y-0.5 border-l border-[var(--kp-divider-light)] pl-2 opacity-60">
              {archivedWorkspaces.map((ws) => (
                <div key={ws.id} className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--kp-text-3)]">
                  <FolderArchive className="h-3 w-3" />
                  <span className="truncate">{ws.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 无 Workspace 的普通 Agent（回退：非 swarm 模式） */}
      {activeWorkspaces.length === 0 && superAgents.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-[var(--kp-text-3)]">
          无 Workspace。通过超级 Agent 创建 Workspace 后此处显示 Agent 树。
        </p>
      )}
    </div>
  );
}

/** Agent 节点：图标按 tier 区分 + 可展开 session 列表 */
function AgentNode({
  agent,
  expanded,
  onToggle,
  effectiveSessionId,
  onSelectSession,
  onSelectAgent,
  searchLower,
}: {
  agent: { id: string; name: string; tier: string; status: string; model: string; workspaceId: string | null };
  expanded: boolean;
  onToggle: () => void;
  effectiveSessionId: string | null;
  onSelectSession: (id: string) => void;
  onSelectAgent: (agentId: string) => void;
  searchLower: string;
  matchesSearch: (text: string) => boolean;
}) {
  const sessionsQuery = trpc.session.list.useQuery(
    { page: 1, pageSize: 50, agentId: agent.id },
    { enabled: expanded },
  );
  const sessions = (sessionsQuery.data?.items ?? []) as ChatSession[];
  const filteredSessions = searchLower
    ? sessions.filter((s) => s.title.toLowerCase().includes(searchLower))
    : sessions;

  const tierIcon = agent.tier === "super" ? Crown : agent.tier === "manager" ? ShieldCheck : Bot;
  const TierIcon = tierIcon;
  const tierColor =
    agent.tier === "super" ? "text-amber-500" : agent.tier === "manager" ? "text-blue-500" : "text-[var(--kp-brand)]";

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onToggle();
          onSelectAgent(agent.id);
        }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-[var(--kp-bg-mute)]",
        )}
      >
        {filteredSessions.length > 0 || expanded ? (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--kp-text-3)]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--kp-text-3)]" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <TierIcon className={cn("h-3.5 w-3.5 shrink-0", tierColor)} />
        <span className="truncate text-[var(--kp-text-1)]">{agent.name}</span>
        {agent.status === "dormant" && <span className="text-[9px] text-[var(--kp-text-3)]">休眠</span>}
      </button>
      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-[var(--kp-divider-light)] pl-2">
          {filteredSessions.length === 0 && (
            <p className="px-2 py-1 text-[10px] text-[var(--kp-text-3)]">无会话</p>
          )}
          {filteredSessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSession(s.id)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition",
                effectiveSessionId === s.id
                  ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)] font-medium"
                  : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
              )}
            >
              {s.isMainSession && <Pin className="h-2.5 w-2.5 shrink-0 text-[var(--kp-brand)]" />}
              <span className="truncate">{s.title}</span>
              <span className="ml-auto shrink-0 text-[9px] text-[var(--kp-text-3)]">{formatRelativeTime(s.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
