/** 从原生工具返回结果提取 Chat 时间线摘要（耗时 / 引擎 / 字数等） */
export function formatToolTimingHint(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (r.error) return null;
  // 异步任务状态查询 / 等待 / 取消 结果友好化
  const asyncHint = formatAsyncJobHint(r);
  if (asyncHint) return asyncHint;
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

/** 毫秒 → 友好时长（180000 → "3m"，1500 → "1.5s"） */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

const ASYNC_STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  queued: "排队中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  active: "活跃",
  not_found: "未找到",
};

/** async_task_status / async_task_wait / async_task_cancel 工具结果摘要 */
function formatAsyncJobHint(r: Record<string, unknown>): string | null {
  // async_task_status 单个 / async_task_wait 返回 { jobId, status, elapsedMs?, asyncResult?, error? }
  if (typeof r.jobId === "string" && typeof r.status === "string") {
    const parts: string[] = [ASYNC_STATUS_LABEL[r.status] ?? r.status];
    if (typeof r.elapsedMs === "number") parts.push(formatDuration(r.elapsedMs));
    if (typeof r.taskLabel === "string" && r.taskLabel) parts.push(r.taskLabel.slice(0, 24));
    return parts.join(" · ");
  }
  // async_task_status 列表 { items: [...] }
  if (Array.isArray(r.items)) {
    const n = r.items.length;
    if (n === 0) return "无任务";
    const running = (r.items as Array<{ status?: string }>).filter((x) => x.status === "running" || x.status === "queued").length;
    return running > 0 ? `${n} 个任务 · ${running} 进行中` : `${n} 个任务`;
  }
  // async_task_cancel 返回 { cancelled, message }
  if (typeof r.cancelled === "boolean") {
    const msg = typeof r.message === "string" ? r.message.slice(0, 36) : "";
    return r.cancelled ? `已取消${msg ? " · " + msg : ""}` : `取消失败${msg ? " · " + msg : ""}`;
  }
  return null;
}
