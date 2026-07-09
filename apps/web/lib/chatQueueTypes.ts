/**
 * Chat 发送队列 — 类型与 LLM 正文拼装（参考 MetaBlog 异步任务 + 发送队列）
 */

export type ChatQueueItemKind = "user" | "async-running" | "async-result";

export interface ChatQueueAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** data URL 或 blob URL，仅前端预览 */
  previewUrl?: string;
  /** OCR 或识图后的文本 */
  extractedText?: string;
  source: "ocr" | "vision" | "user";
}

export interface ChatQueueItem {
  id: string;
  kind: ChatQueueItemKind;
  text: string;
  pinned?: boolean;
  skillId?: string;
  skillPrompt?: string;
  attachments?: ChatQueueAttachment[];
  /** 异步任务 */
  jobId?: string;
  taskLabel?: string;
  status?: "pending" | "queued" | "running" | "done" | "failed"; // user 仅 pending；async 用 queued/running/done/failed
  /** 异步原始结果（不可编辑） */
  asyncResult?: string;
  /** 用户对异步结果追加的说明（可编辑，LLM 会区分） */
  userAppend?: string;
  /** 关联的子 Agent 会话 id，用于在新标签页中对话 */
  subagentSessionId?: string;
  /** 子 Agent 名字，用于消息来源角标 */
  subagentName?: string;
  createdAt: number;
}

export function formatQueueItemForLlm(item: ChatQueueItem, supportsVision = false): string {
  const parts: string[] = [];

  if (item.attachments?.length && !supportsVision) {
    for (const att of item.attachments) {
      if (att.extractedText?.trim()) {
        parts.push(
          `[附件 · ${att.name} · ${att.source === "ocr" ? "OCR 识别" : att.source === "vision" ? "识图" : "用户"}]\n${att.extractedText.trim()}`,
        );
      }
    }
  }

  if (item.kind === "async-result" && item.asyncResult) {
    // 修复：不再往消息内容里塞 [异步任务结果 · ... · 系统生成 · 不可修改] 日志前缀。
    // source="super" 已标识来源，前端 MessageSourceLabel 显示「子 Agent 任务」角标。
    // LLM 上下文由 source 字段 + 消息位置传达，不需要在 content 里加日志行。
    parts.push(item.asyncResult);
    if (item.userAppend?.trim()) {
      parts.push(`[用户补充说明 · 可编辑]\n${item.userAppend.trim()}`);
    }
    if (item.text.trim()) {
      parts.push(item.text.trim());
    }
    return parts.join("\n\n");
  }

  if (item.text.trim()) parts.push(item.text.trim());
  return parts.join("\n\n");
}

export function mergeAsyncPollIntoQueue(
  local: ChatQueueItem[],
  poll?: {
    running?: Array<{ jobId: string; taskLabel: string; subagentSessionId?: string; createdAt: number }>;
    queued?: Array<{ jobId: string; taskLabel: string; position?: number; subagentSessionId?: string; createdAt: number }>;
    deliveries?: Array<{
      id: string;
      jobId: string;
      taskLabel: string;
      asyncResult: string;
      status: "done" | "failed";
      error?: string;
      subagentSessionId?: string;
      subagentName?: string;
      createdAt: number;
    }>;
  },
  opts?: { skipDeliveryJobIds?: ReadonlySet<string> },
): ChatQueueItem[] {
  if (!poll) return local;

  const skipDeliveries = opts?.skipDeliveryJobIds ?? new Set<string>();

  const pollJobIds = new Set<string>();
  for (const j of poll.running ?? []) pollJobIds.add(j.jobId);
  for (const j of poll.queued ?? []) pollJobIds.add(j.jobId);
  for (const d of poll.deliveries ?? []) pollJobIds.add(d.jobId);

  const localByJobId = new Map(
    local.filter((i) => i.jobId).map((i) => [i.jobId!, i] as const),
  );

  let next = local.filter((item) => {
    if (item.kind === "user") return true;
    if (item.kind === "async-running" && item.jobId && !pollJobIds.has(item.jobId)) return true;
    return false;
  });

  for (const job of poll.running ?? []) {
    if (next.some((q) => q.jobId === job.jobId)) continue;
    next.unshift({
      id: `run-${job.jobId}`,
      kind: "async-running",
      text: "",
      jobId: job.jobId,
      taskLabel: job.taskLabel,
      status: "running",
      subagentSessionId: job.subagentSessionId,
      createdAt: job.createdAt,
    });
  }

  for (const job of poll.queued ?? []) {
    if (next.some((q) => q.jobId === job.jobId)) continue;
    next.unshift({
      id: `queued-${job.jobId}`,
      kind: "async-running",
      text: job.position !== undefined ? `排队第 ${job.position + 1}` : "",
      jobId: job.jobId,
      taskLabel: job.taskLabel,
      status: "queued",
      subagentSessionId: job.subagentSessionId,
      createdAt: job.createdAt,
    });
  }

  for (const del of poll.deliveries ?? []) {
    if (skipDeliveries.has(del.jobId)) continue;
    next = next.filter((q) => q.jobId !== del.jobId);
    const prev = localByJobId.get(del.jobId);
    next.unshift({
      id: del.id,
      kind: "async-result",
      text: prev?.text ?? "",
      jobId: del.jobId,
      taskLabel: del.taskLabel,
      asyncResult:
        del.status === "failed" ? `任务失败：${del.error || "未知错误"}` : del.asyncResult,
      status: del.status,
      userAppend: prev?.userAppend ?? "",
      subagentSessionId: del.subagentSessionId ?? prev?.subagentSessionId,
      subagentName: del.subagentName ?? prev?.subagentName,
      createdAt: del.createdAt,
    });
  }

  return next;
}

export function extractLocalQueueFromMerged(
  merged: ChatQueueItem[],
  poll?: {
    running?: Array<{ jobId: string }>;
    queued?: Array<{ jobId: string }>;
    deliveries?: Array<{ jobId: string }>;
  },
): ChatQueueItem[] {
  const pollRunning = new Set([
    ...(poll?.running ?? []).map((j) => j.jobId),
    ...(poll?.queued ?? []).map((j) => j.jobId),
  ]);
  const userItems = merged.filter((i) => i.kind === "user");
  const overlays: ChatQueueItem[] = [];

  for (const item of merged) {
    if (item.kind === "async-running" && item.jobId && !pollRunning.has(item.jobId)) {
      overlays.push(item);
    }
    if (item.kind === "async-result" && item.jobId && (item.userAppend?.trim() || item.text.trim())) {
      overlays.push({
        ...item,
        id: item.id.startsWith("overlay-") ? item.id : `overlay-${item.jobId}`,
        asyncResult: undefined,
      });
    }
  }

  return [...userItems, ...overlays];
}

/** 把合并后的队列拆成两个物理独立的队列：
 *  - userQueue: 用户主动发送的消息（kind="user"）
 *  - asyncOverlays: 异步结果的用户追加编辑（async-result 带 userAppend/text，或不再被 poll 跟踪的 async-running）
 *  两队列物理独立，consumeQueue 先查 asyncResultQueue 再查 userQueue，避免冲突。 */
export function splitQueueByKind(
  merged: ChatQueueItem[],
  poll?: {
    running?: Array<{ jobId: string }>;
    queued?: Array<{ jobId: string }>;
    deliveries?: Array<{ jobId: string }>;
  },
): { userQueue: ChatQueueItem[]; asyncOverlays: ChatQueueItem[] } {
  const pollRunning = new Set([
    ...(poll?.running ?? []).map((j) => j.jobId),
    ...(poll?.queued ?? []).map((j) => j.jobId),
  ]);
  const userQueue = merged.filter((i) => i.kind === "user");
  const asyncOverlays: ChatQueueItem[] = [];

  for (const item of merged) {
    if (item.kind === "async-running" && item.jobId && !pollRunning.has(item.jobId)) {
      asyncOverlays.push(item);
    }
    if (item.kind === "async-result" && item.jobId && (item.userAppend?.trim() || item.text.trim())) {
      asyncOverlays.push({
        ...item,
        id: item.id.startsWith("overlay-") ? item.id : `overlay-${item.jobId}`,
        asyncResult: undefined,
      });
    }
  }

  return { userQueue, asyncOverlays };
}

export function sortQueueItems(items: ChatQueueItem[]): ChatQueueItem[] {
  const byCreatedAt = (a: ChatQueueItem, b: ChatQueueItem) => a.createdAt - b.createdAt;
  // 优先级：pinned > async-result（异步任务结果投递）> user（用户主动消息）
  // ARQ > User Queue：后台任务完成后结果应优先于用户后续消息被消费，
  // 避免用户连续发消息把异步结果挤到后面
  const pinned = items.filter((i) => i.pinned).sort(byCreatedAt);
  const asyncResults = items.filter((i) => !i.pinned && i.kind === "async-result").sort(byCreatedAt);
  const rest = items.filter((i) => !i.pinned && i.kind !== "async-result").sort(byCreatedAt);
  return [...pinned, ...asyncResults, ...rest];
}

export function createUserQueueItem(
  text: string,
  opts?: { skillId?: string; skillPrompt?: string; attachments?: ChatQueueAttachment[] },
): ChatQueueItem {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "user",
    text,
    status: "pending",
    skillId: opts?.skillId,
    skillPrompt: opts?.skillPrompt,
    attachments: opts?.attachments,
    createdAt: Date.now(),
  };
}
