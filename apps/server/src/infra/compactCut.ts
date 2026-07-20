/**
 * Compaction 切割规则（pi 移植）— 纯函数叶子
 *
 * - 切点合法性：绝不切在 toolCall 与 toolResult 之间
 * - 从最新向最旧累计 keepRecentTokens 定初切点，不安全则向旧侧移动
 * - 跨压缩累计 readFiles / modifiedFiles
 */

import type { LlmMessage } from "./llmClient.js";

/** 默认保留最近约 20k tokens（字符粗估 /4） */
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;

const DETAILS_START = "<!--kp-compact-details:";
const DETAILS_END = "-->";

export type CompactFileDetails = {
  readFiles: string[];
  modifiedFiles: string[];
};

/** 单条消息 token 粗估（字符 / 4，与 Auto-Compact 字符阈值同源） */
export function estimateMessageTokens(m: LlmMessage): number {
  const contentLen =
    typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
  const toolsLen = m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
  return Math.max(1, Math.ceil((contentLen + toolsLen + 200) / 4));
}

/** 段内 tool call / result 是否成对（无缺 call、无缺 result） */
export function toolPairsComplete(segment: LlmMessage[]): boolean {
  const pending = new Set<string>();
  for (const m of segment) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        if (tc.id) pending.add(tc.id);
      }
    } else if (m.role === "tool" && m.tool_call_id) {
      if (!pending.has(m.tool_call_id)) return false;
      pending.delete(m.tool_call_id);
    }
  }
  return pending.size === 0;
}

/** cut = 保留段起点；两侧都必须 call/result 成对，且切点不得落在 tool 消息上 */
export function isSafeCompactCutIndex(messages: LlmMessage[], cut: number): boolean {
  if (cut < 0 || cut > messages.length) return false;
  if (cut < messages.length && messages[cut]?.role === "tool") return false;
  return toolPairsComplete(messages.slice(0, cut)) && toolPairsComplete(messages.slice(cut));
}

/**
 * 从最新向最旧累计 keepRecentTokens 定初切点；不安全则向旧侧移动到安全边界。
 * @param startIndex 迭代摘要起点（上次 firstKept）；默认跳过 leading system
 */
export function findCompactCutIndex(
  messages: LlmMessage[],
  keepRecentTokens: number,
  startIndex?: number,
): number {
  const budget = Math.max(1, keepRecentTokens);
  let start = startIndex ?? 0;
  if (startIndex == null) {
    const firstNonSystem = messages.findIndex((m) => m.role !== "system");
    start = firstNonSystem >= 0 ? firstNonSystem : 0;
  }
  start = Math.max(0, Math.min(start, messages.length));
  if (start >= messages.length) return start;

  let accumulated = 0;
  let cut = start;
  for (let i = messages.length - 1; i >= start; i--) {
    accumulated += estimateMessageTokens(messages[i]!);
    if (accumulated >= budget) {
      cut = i;
      break;
    }
  }

  while (cut > start && !isSafeCompactCutIndex(messages, cut)) {
    cut--;
  }
  if (isSafeCompactCutIndex(messages, cut)) return cut;

  for (let i = cut; i <= messages.length; i++) {
    if (isSafeCompactCutIndex(messages, i)) return i;
  }
  return start;
}

const READ_TOOLS = new Set([
  "read_file",
  "read",
  "read_article",
  "fs_read",
  "cat",
]);
const WRITE_TOOLS = new Set([
  "write_file",
  "write",
  "edit",
  "edit_file",
  "fs_write",
  "apply_patch",
  "directory_create",
]);

function pathFromArgs(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file", "filePath", "filename", "target"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** 从被压缩段工具调用参数提取读/写文件路径 */
export function extractFileOpsFromMessages(messages: LlmMessage[]): CompactFileDetails {
  const read = new Set<string>();
  const modified = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    for (const tc of m.tool_calls) {
      const name = tc.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
      } catch {
        continue;
      }
      const path = pathFromArgs(args);
      if (!path) continue;
      if (WRITE_TOOLS.has(name) || /write|edit|create|delete|patch/i.test(name)) {
        modified.add(path);
      } else if (READ_TOOLS.has(name) || /read|list|stat|search/i.test(name)) {
        read.add(path);
      }
    }
  }
  const modifiedFiles = [...modified].sort();
  const readFiles = [...read].filter((f) => !modified.has(f)).sort();
  return { readFiles, modifiedFiles };
}

export function mergeCompactFileDetails(
  prev: CompactFileDetails | null | undefined,
  next: CompactFileDetails | null | undefined,
): CompactFileDetails {
  const read = new Set<string>([...(prev?.readFiles ?? []), ...(next?.readFiles ?? [])]);
  const modified = new Set<string>([...(prev?.modifiedFiles ?? []), ...(next?.modifiedFiles ?? [])]);
  for (const f of modified) read.delete(f);
  return {
    readFiles: [...read].sort(),
    modifiedFiles: [...modified].sort(),
  };
}

export function parseCompactFileDetails(summary: string): CompactFileDetails | null {
  const start = summary.lastIndexOf(DETAILS_START);
  if (start < 0) return null;
  const jsonStart = start + DETAILS_START.length;
  const end = summary.indexOf(DETAILS_END, jsonStart);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(summary.slice(jsonStart, end).trim()) as CompactFileDetails;
    return {
      readFiles: Array.isArray(parsed.readFiles) ? parsed.readFiles.map(String) : [],
      modifiedFiles: Array.isArray(parsed.modifiedFiles) ? parsed.modifiedFiles.map(String) : [],
    };
  } catch {
    return null;
  }
}

/** 剥离旧 details 块后嵌入合并后的 details JSON */
export function formatCompactFileDetails(
  summaryBody: string,
  details: CompactFileDetails,
): string {
  let body = summaryBody;
  const start = body.lastIndexOf(DETAILS_START);
  if (start >= 0) {
    const end = body.indexOf(DETAILS_END, start);
    if (end >= 0) {
      body = (body.slice(0, start) + body.slice(end + DETAILS_END.length)).trimEnd();
    }
  }
  const prev = parseCompactFileDetails(summaryBody);
  const merged = mergeCompactFileDetails(prev, details);
  if (merged.readFiles.length === 0 && merged.modifiedFiles.length === 0) {
    return body.trimEnd();
  }
  return `${body.trimEnd()}\n\n${DETAILS_START}${JSON.stringify(merged)}${DETAILS_END}`;
}
