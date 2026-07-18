/**
 * 实体人类可读标签（前后端共用）— 禁止回退到裸 cuid/uuid。
 */

export type SessionLike = {
  autoName?: string | null;
  title?: string | null;
  taskDescription?: string | null;
};

export type AgentLike = {
  autoName?: string | null;
  name?: string | null;
};

function firstNonEmpty(...parts: Array<string | null | undefined>): string | undefined {
  for (const p of parts) {
    const t = typeof p === "string" ? p.trim() : "";
    if (t) return t;
  }
  return undefined;
}

export function sessionLabel(s: SessionLike | null | undefined, fallback = "新对话"): string {
  if (!s) return fallback;
  const task = s.taskDescription?.trim();
  return (
    firstNonEmpty(s.autoName, s.title, task ? task.slice(0, 40) : undefined) ?? fallback
  );
}

export function agentLabel(a: AgentLike | null | undefined, fallback = "未命名 Agent"): string {
  if (!a) return fallback;
  return firstNonEmpty(a.autoName, a.name) ?? fallback;
}

export function memoryLabel(
  m: { content?: string | null } | null | undefined,
  fallback = "未命名记忆",
): string {
  if (!m) return fallback;
  const c = m.content?.trim();
  if (!c) return fallback;
  return c.length > 40 ? `${c.slice(0, 40)}…` : c;
}

/** Run 主标签 */
export function runLabel(opts: {
  agentName?: string | null;
  sessionLabel?: string | null;
  status?: string | null;
}): string {
  const agent = opts.agentName?.trim();
  const sess = opts.sessionLabel?.trim();
  const status = opts.status?.trim();
  if (agent && sess) return `${agent} · ${sess}`;
  if (agent && status) return `${agent} · ${status}`;
  if (agent) return agent;
  if (sess) return sess;
  if (status) return `运行 · ${status}`;
  return "运行记录";
}
