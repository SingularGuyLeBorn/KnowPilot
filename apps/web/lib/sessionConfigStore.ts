/**
 * E8：会话 ChatConfig 单一事实源（per-session Map）。
 *
 * localStorage 仍是持久层；本 store 是运行时权威切片。
 * runStream / drain / mount-resume 必须经 get/ensureHydrated 按 sessionId 取 config，
 * 禁止吃 React 闭包里的 focusedPaneConfig / 首帧 DEFAULT。
 */

import {
  DEFAULT_CHAT_CONFIG,
  loadSessionChatConfig,
  saveSessionChatConfig,
} from "@/lib/chatConfig";
import type { ChatSessionConfig } from "@knowpilot/shared";

const configs = new Map<string, ChatSessionConfig>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** 同步保证 session 有切片：优先内存 → localStorage → DEFAULT */
export function ensureSessionConfigHydrated(sessionId: string): ChatSessionConfig {
  const hit = configs.get(sessionId);
  if (hit) return hit;
  const fromLs = loadSessionChatConfig(sessionId);
  const next = fromLs ? { ...DEFAULT_CHAT_CONFIG, ...fromLs } : { ...DEFAULT_CHAT_CONFIG };
  configs.set(sessionId, next);
  notify();
  return next;
}

export function getSessionConfig(sessionId: string): ChatSessionConfig {
  return configs.get(sessionId) ?? ensureSessionConfigHydrated(sessionId);
}

/** React hook / updateConfig 写入权威切片（可选落盘由调用方负责） */
export function setSessionConfig(sessionId: string, config: ChatSessionConfig, persist = false): void {
  configs.set(sessionId, config);
  if (persist) saveSessionChatConfig(sessionId, config);
  notify();
}

export function patchSessionConfig(
  sessionId: string,
  patch: Partial<ChatSessionConfig>,
  persist = true,
): ChatSessionConfig {
  const prev = getSessionConfig(sessionId);
  const next = { ...prev, ...patch };
  setSessionConfig(sessionId, next, persist);
  return next;
}

export function migrateSessionConfig(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const cfg = configs.get(fromId);
  if (cfg) {
    configs.set(toId, cfg);
    configs.delete(fromId);
    saveSessionChatConfig(toId, cfg);
    notify();
  }
}

export function subscribeSessionConfigStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetSessionConfigStoreForTests(): void {
  configs.clear();
}
