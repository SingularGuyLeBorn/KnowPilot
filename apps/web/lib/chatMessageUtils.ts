/**
 * Chat 消息分组与多版本解析 — 前端展示层
 */

import type { ChatMessage } from "@knowpilot/shared";
import { formatToolResultHint, formatToolTimingHint } from "@knowpilot/shared";
import { isCompactBoundaryMessage } from "@/lib/compactMarkers";

export type ToolCallRecord = {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  kind?: "tool" | "thinking" | "content";
};

export interface AssistantVersionEntry {
  id: string;
  content: string;
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}

export interface MessageGroup {
  userMessage: ChatMessage & { skillName?: string; skillIcon?: string | null };
  assistantMessage?: ChatMessage;
  versions: AssistantVersionEntry[];
  activeVersionIndex: number;
}

export function parseToolCalls(raw: unknown): ToolCallRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc, i) => ({
    id: typeof tc?.id === "string" ? tc.id : `tc_${i}`,
    name: String(tc?.name ?? ""),
    args: tc?.args ?? {},
    result: tc?.result ?? null,
    kind:
      tc?.kind === "thinking" || tc?.name === "__thinking__"
        ? "thinking"
        : tc?.kind === "content" || tc?.name === "__content__"
          ? "content"
          : "tool",
  }));
}

function parseVersionMeta(raw: unknown): { versions: AssistantVersionEntry[]; activeIndex: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const vm = (raw as { versionMeta?: { versions: AssistantVersionEntry[]; activeIndex: number } }).versionMeta;
  if (!vm?.versions?.length) return null;
  return { versions: vm.versions, activeIndex: vm.activeIndex ?? 0 };
}

function parseUserSkill(raw: unknown): { name?: string; icon?: string | null } {
  if (!raw || typeof raw !== "object") return {};
  const skill = (raw as { skill?: { name?: string; icon?: string | null } }).skill;
  return skill ? { name: skill.name, icon: skill.icon } : {};
}

function attachAssistantToGroup(g: MessageGroup, msg: ChatMessage): void {
  g.assistantMessage = msg;
  const meta = parseVersionMeta(msg.toolResults);
  if (meta) {
    g.versions = meta.versions.map((v) => ({
      ...v,
      toolCalls: parseToolCalls(v.toolCalls),
    }));
    g.activeVersionIndex = meta.activeIndex;
  } else {
    g.versions = [
      {
        id: msg.id,
        content: msg.content,
        toolCalls: parseToolCalls(msg.toolCalls),
        createdAt: typeof msg.createdAt === "string" ? msg.createdAt : new Date().toISOString(),
      },
    ];
    g.activeVersionIndex = 0;
  }
}

export function buildMessageGroups(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const msg of messages) {
    // 压缩边界不挂到上一轮 assistant，避免盖住真实回复
    if (isCompactBoundaryMessage(msg)) continue;
    if (msg.role === "user") {
      const skill = parseUserSkill(msg.toolResults);
      groups.push({
        userMessage: {
          ...msg,
          skillName: skill.name,
          skillIcon: skill.icon,
        },
        versions: [],
        activeVersionIndex: 0,
      });
      continue;
    }
    if (msg.role === "assistant" && groups.length > 0) {
      attachAssistantToGroup(groups[groups.length - 1]!, msg);
    }
  }
  return groups;
}

/** 时间线项：普通对话轮 + 压缩边界卡片（点击才看摘要） */
export type ChatTimelineItem =
  | { kind: "group"; group: MessageGroup }
  | { kind: "compact"; message: ChatMessage };

export function buildChatTimeline(messages: ChatMessage[]): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  let current: MessageGroup | null = null;

  const flush = () => {
    if (current) {
      items.push({ kind: "group", group: current });
      current = null;
    }
  };

  for (const msg of messages) {
    if (isCompactBoundaryMessage(msg)) {
      flush();
      items.push({ kind: "compact", message: msg });
      continue;
    }
    if (msg.role === "user") {
      flush();
      const skill = parseUserSkill(msg.toolResults);
      current = {
        userMessage: {
          ...msg,
          skillName: skill.name,
          skillIcon: skill.icon,
        },
        versions: [],
        activeVersionIndex: 0,
      };
      continue;
    }
    if (msg.role === "assistant" && current) {
      attachAssistantToGroup(current, msg);
    }
  }
  flush();
  return items;
}

export function getActiveVersion(group: MessageGroup): AssistantVersionEntry | null {
  if (!group.versions.length) return null;
  return group.versions[group.activeVersionIndex] ?? group.versions[group.versions.length - 1];
}

export type TimelineStep =
  | { type: "thinking"; content: string; round: number }
  | { type: "content"; content: string; round: number }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      args: unknown;
      result?: unknown;
      hint?: string | null;
      round: number;
      status: "preparing" | "running" | "done";
      /** 工具开始执行的本地时间戳，用于 sleep 等长等待的倒计时 */
      startedAt?: number;
      /** 组装参数阶段已生成的参数字符数（tool_preparing） */
      argsChars?: number;
    }
  | {
      type: "progress";
      jobId: string;
      label: string;
      content?: string;
      round: number;
      status: "queued" | "running" | "done" | "failed";
    };

export { formatToolResultHint, formatToolTimingHint };

export function buildTimelineFromStored(toolCalls?: ToolCallRecord[]): TimelineStep[] {
  if (!toolCalls?.length) return [];
  const steps: TimelineStep[] = [];
  for (const tc of toolCalls) {
    const round =
      typeof (tc.args as { round?: number })?.round === "number" ? (tc.args as { round: number }).round : 1;
    if (tc.kind === "thinking") {
      const content = String(tc.result ?? "").trim();
      // 空思考不进时间线（历史消息里也不展示空壳 Thinking）
      if (!content) continue;
      steps.push({ type: "thinking", content, round });
    } else if (tc.kind === "content") {
      steps.push({ type: "content", content: String(tc.result ?? ""), round });
    } else {
      steps.push({
        type: "tool",
        toolCallId: tc.id,
        name: tc.name,
        args: tc.args,
        result: tc.result,
        hint: formatToolResultHint(tc.result),
        round,
        status: "done",
      });
    }
  }
  return steps;
}

/** 去掉仍无正文的 Thinking 占位（工具已开始 / 落库前清理） */
export function pruneEmptyThinkingSteps(steps: TimelineStep[]): TimelineStep[] {
  return steps.filter((s) => s.type !== "thinking" || !!s.content.trim());
}
