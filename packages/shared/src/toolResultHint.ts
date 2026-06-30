/** 从原生工具返回结果提取 Chat 时间线摘要（耗时 / 引擎 / 字数等） */
export function formatToolTimingHint(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (r.error) return null;
  const parts: string[] = [];
  if (typeof r.elapsedMs === "number") parts.push(`${r.elapsedMs}ms`);
  const engine = r.engine ?? r.provider;
  if (typeof engine === "string" && engine) parts.push(engine);
  if (Array.isArray(r.enginesAttempted) && r.enginesAttempted.length > 1) {
    parts.push(r.enginesAttempted.map(String).join("→"));
  }
  if (typeof r.searchPhase === "string") parts.push(r.searchPhase);
  if (Array.isArray(r.infoSourcesUsed) && r.infoSourcesUsed.length > 0) {
    parts.push(`${r.infoSourcesUsed.length} 信息源`);
  }
  if (typeof r.platform === "string" && r.platform && r.platform !== "unknown") parts.push(r.platform);
  if (typeof r.author === "string" && r.author.trim()) parts.push(r.author.trim().slice(0, 24));
  if (typeof r.method === "string" && r.method) parts.push(r.method);
  if (typeof r.contentChars === "number") {
    parts.push(`${r.contentChars} 字`);
    if (r.contentTruncated === true) parts.push("已截断");
    if (typeof r.contentWarning === "string" && r.contentWarning) parts.push(r.contentWarning);
  } else if (typeof r.textChars === "number") {
    parts.push(`${r.textChars} 字`);
    if (r.textTruncated === true) parts.push("已截断");
  }
  if (typeof r.suggestedTool === "string" && r.suggestedTool) parts.push(`→${r.suggestedTool}`);
  if (typeof r.total === "number" && typeof r.query === "string") parts.push(`${r.total} 条`);
  return parts.length ? parts.join(" · ") : null;
}

/** 工具失败摘要 */
export function formatToolErrorHint(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  const err = r.error;
  if (typeof err !== "string" || !err.trim()) return null;
  const parts = ["失败", err.split("\n")[0].slice(0, 72)];
  if (typeof r.elapsedMs === "number") parts.push(`${r.elapsedMs}ms`);
  return parts.join(" · ");
}

/** 成功或失败均尝试生成摘要（Chat 时间线 / SSE hint） */
export function formatToolResultHint(result: unknown): string | null {
  return formatToolTimingHint(result) ?? formatToolErrorHint(result);
}
