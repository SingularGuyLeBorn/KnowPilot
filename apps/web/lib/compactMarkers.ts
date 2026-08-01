/** 与 server autoCompact 对齐的摘要边界标记（前端检测用） */
export const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";
export const COMPACT_BOUNDARY_PREFIX = "[kp-compact-boundary:";

export const DEFAULT_COMPACT_TRIGGER_RATIO = 0.75;

export function isCompactBoundaryContent(content: string): boolean {
  return content.includes(COMPACT_BOUNDARY_PREFIX);
}

/** 压缩边界气泡：不进普通对话组，单独渲染为可展开卡片 */
export function isCompactBoundaryMessage(msg: {
  content?: string | null;
  toolCalls?: unknown;
}): boolean {
  if (msg.content && isCompactBoundaryContent(msg.content)) return true;
  if (!Array.isArray(msg.toolCalls)) return false;
  return msg.toolCalls.some(
    (tc) =>
      tc &&
      typeof tc === "object" &&
      ((tc as { kind?: string }).kind === "compact" ||
        (tc as { name?: string }).name === "__context_compact__"),
  );
}
