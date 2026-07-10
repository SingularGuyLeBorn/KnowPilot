/**
 * Chat 消息分组与多版本解析 — 前端展示层
 */

import type { ChatMessage } from "@knowpilot/shared";
import { formatToolResultHint, formatToolTimingHint } from "@knowpilot/shared";

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

export function buildMessageGroups(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let pendingUser: (ChatMessage & { skillName?: string; skillIcon?: string | null }) | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      const skill = parseUserSkill(msg.toolResults);
      pendingUser = {
        ...msg,
        skillName: skill.name,
        skillIcon: skill.icon,
      };
      groups.push({
        userMessage: pendingUser,
        versions: [],
        activeVersionIndex: 0,
      });
      continue;
    }
    if (msg.role === "assistant" && groups.length > 0) {
      const g = groups[groups.length - 1];
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
  }
  return groups;
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
      status: "running" | "done";
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
      steps.push({ type: "thinking", content: String(tc.result ?? ""), round });
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
