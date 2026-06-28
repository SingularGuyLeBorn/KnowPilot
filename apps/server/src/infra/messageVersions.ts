/**
 * Assistant 消息多版本元数据 — 存于 ChatMessage.toolResults.versionMeta
 */

import type { StoredToolCall } from "./chatHistory.js";

export interface AssistantVersionEntry {
  id: string;
  content: string;
  toolCalls?: StoredToolCall[];
  createdAt: string;
}

export interface AssistantVersionMeta {
  versions: AssistantVersionEntry[];
  activeIndex: number;
}

export interface UserMessageMeta {
  skill?: { id: string; name: string; icon?: string | null };
}

export function parseAssistantVersionMeta(raw: unknown): AssistantVersionMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const vm = (raw as { versionMeta?: AssistantVersionMeta }).versionMeta;
  if (!vm?.versions?.length) return null;
  return {
    versions: vm.versions,
    activeIndex: typeof vm.activeIndex === "number" ? vm.activeIndex : 0,
  };
}

export function parseUserMessageMeta(raw: unknown): UserMessageMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const skill = (raw as UserMessageMeta).skill;
  return skill ? { skill } : null;
}

/** 从 DB 消息解析当前激活版本的内容与 toolCalls */
export function getActiveAssistantPayload(msg: {
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
}): { content: string; toolCalls: StoredToolCall[]; versionMeta: AssistantVersionMeta } {
  const existing = parseAssistantVersionMeta(msg.toolResults);
  if (existing) {
    const active = existing.versions[existing.activeIndex] ?? existing.versions[existing.versions.length - 1];
    return {
      content: active.content,
      toolCalls: (active.toolCalls ?? []) as StoredToolCall[],
      versionMeta: existing,
    };
  }
  const versions: AssistantVersionEntry[] = [
    {
      id: `v_${Date.now()}`,
      content: msg.content,
      toolCalls: Array.isArray(msg.toolCalls) ? (msg.toolCalls as StoredToolCall[]) : [],
      createdAt: new Date().toISOString(),
    },
  ];
  return {
    content: msg.content,
    toolCalls: versions[0].toolCalls ?? [],
    versionMeta: { versions, activeIndex: 0 },
  };
}

export function buildInitialVersionMeta(
  content: string,
  toolCalls: StoredToolCall[],
): { toolResults: { versionMeta: AssistantVersionMeta } } {
  return {
    toolResults: {
      versionMeta: {
        versions: [
          {
            id: `v_${Date.now()}`,
            content,
            toolCalls,
            createdAt: new Date().toISOString(),
          },
        ],
        activeIndex: 0,
      },
    },
  };
}

export function appendAssistantVersion(
  current: AssistantVersionMeta,
  content: string,
  toolCalls: StoredToolCall[],
): AssistantVersionMeta {
  const versions = [
    ...current.versions,
    { id: `v_${Date.now()}`, content, toolCalls, createdAt: new Date().toISOString() },
  ];
  return { versions, activeIndex: versions.length - 1 };
}

export function switchAssistantVersion(current: AssistantVersionMeta, index: number): AssistantVersionMeta {
  if (index < 0 || index >= current.versions.length) {
    throw new Error(`版本索引 ${index} 无效`);
  }
  return { ...current, activeIndex: index };
}

export function activeVersionPayload(meta: AssistantVersionMeta): {
  content: string;
  toolCalls: StoredToolCall[];
} {
  const v = meta.versions[meta.activeIndex];
  return { content: v.content, toolCalls: v.toolCalls ?? [] };
}
