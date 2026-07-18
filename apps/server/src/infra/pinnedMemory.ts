/**
 * L1 常驻层：USER.md / AGENT.md 硬预算 + 会话冻结快照。
 *
 * - 文件真相源：content/memories/_pinned/{USER,AGENT}.md（`_` 目录不被 db:sync 扫入 Memory 表）
 * - 注入：会话首轮读盘截断后写入 ChatSession.pinnedMemorySnapshot，后续轮次只读快照
 * - 写工具改文件立即落盘，但本会话 prompt 不变（保 prefix cache / 冻结语义）
 */

import fs from "fs";
import path from "path";
import {
  PINNED_MEMORY_AGENT_FILE,
  PINNED_MEMORY_AGENT_MAX_CHARS,
  PINNED_MEMORY_DIR,
  PINNED_MEMORY_USER_FILE,
  PINNED_MEMORY_USER_MAX_CHARS,
} from "@knowpilot/shared";
import type { ServiceContainer } from "./serviceContainer.js";

export type PinnedWhich = "user" | "agent";

function pinnedDir(projectRoot: string): string {
  return path.resolve(projectRoot, PINNED_MEMORY_DIR);
}

function filePath(projectRoot: string, which: PinnedWhich): string {
  const name = which === "user" ? PINNED_MEMORY_USER_FILE : PINNED_MEMORY_AGENT_FILE;
  return path.join(pinnedDir(projectRoot), name);
}

/** 截断到硬预算；返回截断后文本与是否发生截断 */
export function truncatePinned(text: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, maxChars).trimEnd() + "\n…（已截断）", truncated: true };
}

export function maxCharsFor(which: PinnedWhich): number {
  return which === "user" ? PINNED_MEMORY_USER_MAX_CHARS : PINNED_MEMORY_AGENT_MAX_CHARS;
}

function readFileSafe(abs: string): string {
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

/** 从磁盘加载并截断（不冻结） */
export function loadPinnedFromDisk(projectRoot: string): {
  user: string;
  agent: string;
  userTruncated: boolean;
  agentTruncated: boolean;
} {
  const u = truncatePinned(readFileSafe(filePath(projectRoot, "user")), PINNED_MEMORY_USER_MAX_CHARS);
  const a = truncatePinned(readFileSafe(filePath(projectRoot, "agent")), PINNED_MEMORY_AGENT_MAX_CHARS);
  return { user: u.text, agent: a.text, userTruncated: u.truncated, agentTruncated: a.truncated };
}

/** 格式化为注入 system prompt 的片段（空文件则省略对应节） */
export function formatPinnedHint(user: string, agent: string): string {
  const parts: string[] = [];
  if (user.trim()) parts.push(`### USER（用户偏好，会话内冻结）\n${user.trim()}`);
  if (agent.trim()) parts.push(`### AGENT（工作约定，会话内冻结）\n${agent.trim()}`);
  if (parts.length === 0) return "";
  return `\n\n## 常驻记忆（L1）\n${parts.join("\n\n")}`;
}

/**
 * 会话冻结：有 sessionId 则幂等写入/读取 pinnedMemorySnapshot；
 * 无 sessionId（如一次性 run）则每次读盘（不持久化）。
 */
export async function ensurePinnedMemoryHint(
  services: ServiceContainer,
  sessionId?: string | null,
): Promise<string> {
  const projectRoot = services.config.projectRoot;
  if (sessionId) {
    const row = await services.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { pinnedMemorySnapshot: true },
    });
    if (row?.pinnedMemorySnapshot) return row.pinnedMemorySnapshot;

    const loaded = loadPinnedFromDisk(projectRoot);
    const hint = formatPinnedHint(loaded.user, loaded.agent);
    await services.prisma.chatSession.update({
      where: { id: sessionId },
      data: { pinnedMemorySnapshot: hint },
    });
    return hint;
  }

  const loaded = loadPinnedFromDisk(projectRoot);
  return formatPinnedHint(loaded.user, loaded.agent);
}

export function readPinnedFile(projectRoot: string, which: PinnedWhich): {
  content: string;
  maxChars: number;
  chars: number;
  truncated: boolean;
  path: string;
} {
  const maxChars = maxCharsFor(which);
  const abs = filePath(projectRoot, which);
  const raw = readFileSafe(abs);
  const { text, truncated } = truncatePinned(raw, maxChars);
  return {
    content: text,
    maxChars,
    chars: text.length,
    truncated: truncated || raw.length > maxChars,
    path: path.relative(projectRoot, abs).replace(/\\/g, "/"),
  };
}

export function writePinnedFile(
  projectRoot: string,
  which: PinnedWhich,
  content: string,
): {
  content: string;
  maxChars: number;
  chars: number;
  truncated: boolean;
  path: string;
  note: string;
} {
  const maxChars = maxCharsFor(which);
  const { text, truncated } = truncatePinned(content, maxChars);
  const dir = pinnedDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const abs = filePath(projectRoot, which);
  fs.writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`, "utf-8");
  return {
    content: text,
    maxChars,
    chars: text.length,
    truncated,
    path: path.relative(projectRoot, abs).replace(/\\/g, "/"),
    note: "已写盘；当前进行中的会话仍使用冻结快照，新会话才会读到本次更新。",
  };
}
