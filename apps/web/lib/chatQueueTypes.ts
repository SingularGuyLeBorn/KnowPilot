/**
 * Chat 发送队列 — 类型与 LLM 正文拼装（参考 MetaBlog 异步任务 + 发送队列）
 */

export type ChatQueueItemKind = "user" | "async-running" | "async-result" | "superior" | "child_notify";

/** 排队阻塞原因：哪个上限卡住（与服务端 AsyncJobQueuedReason 一致，orchestrator 真实判定） */
export type AsyncQueuedReason = "global" | "session" | "workspace" | "gate";

const ASYNC_QUEUED_REASON_LABEL: Record<AsyncQueuedReason, string> = {
  global: "全局上限",
  session: "会话上限",
  workspace: "workspace 上限",
  gate: "审批 gate",
};

/** queued 条目的排队提示：「第 N 位 · 因 X 上限排队」（数据均来自池统计，缺哪段省哪段） */
export function formatQueuedHint(item: {
  queuePosition?: number;
  queuedReason?: AsyncQueuedReason;
  gateBlock?: { approvalId: string; scope: string; reason?: string };
}): string {
  const parts: string[] = [];
  if (item.queuePosition !== undefined) parts.push(`第 ${item.queuePosition + 1} 位`);
  if (item.queuedReason === "gate" && item.gateBlock) {
    parts.push(`因审批 ${item.gateBlock.approvalId} 阻塞 scope ${item.gateBlock.scope}`);
  } else if (item.queuedReason) {
    parts.push(`因${ASYNC_QUEUED_REASON_LABEL[item.queuedReason]}排队`);
  }
  return parts.join(" · ");
}

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
  /** queued 任务在池队列中的位置（0-based，来自 orchestrator.getPosition） */
  queuePosition?: number;
  /** queued 任务的排队原因：哪个上限卡住（来自 orchestrator.getQueuedReason） */
  queuedReason?: AsyncQueuedReason;
  /** W3：reason=gate 时的阻塞详情 */
  gateBlock?: { approvalId: string; scope: string; reason?: string };
  /** 异步原始结果（不可编辑） */
  asyncResult?: string;
  /** 用户对异步结果追加的说明（可编辑，LLM 会区分） */
  userAppend?: string;
  /** 关联的子 Agent 会话 id，用于在新标签页中对话 */
  subagentSessionId?: string;
  /** 子 Agent 名字，用于消息来源角标 */
  subagentName?: string;
  /** 已完成的 overlay 自动移除时间戳（ms），仅本地 async-result 使用 */
  removeAt?: number;
  /** 服务端 autoConsume 赢得原子 CLAIM 后由 merge 纯派生的完成态展示项：只展示，不可再被 consumeQueue 消费 */
  serverConsumed?: boolean;
  /** 任务执行过程中的进度/日志 */
  logs?: Array<{ timestamp: number; level: "info" | "progress" | "error"; message: string }>;
  createdAt: number;
  /** DB SessionQueueItem.id（持久化后回填；消费/删除/重排时用） */
  dbId?: string;
  /** 上级 Agent 消息镜像：关联的 AgentMessage id */
  agentMessageId?: string;
  /** 来源标识：user | superior Agent id */
  source?: string;
  /** 来源显示名（superior 专用） */
  sourceName?: string;
  /** 异步任务来源类型：sleep / async_task_llm / async_task_tool / subagent */
  sourceType?: string;
}

/**
 * 右栏「同步任务」元素（W-A）—— 服务端 SyncAsyncJob（asyncJobManager.listSyncAsyncJobs）一一对应。
 * waitForResult=true 的任务：结果走 tool return，不进异步队列/气泡，此列表只展示
 * （无 pin、无消费、无气泡发送）。
 */
export interface SyncTaskItem {
  jobId: string;
  taskLabel: string;
  status: "queued" | "running" | "completed" | "failed";
  elapsedMs?: number;
  asyncResult?: string;
  error?: string;
  logs?: ChatQueueItem["logs"];
  createdAt: number;
  finishedAt?: number;
  subagentSessionId?: string;
  sourceType?: string;
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

  if (item.kind === "child_notify") {
    if (item.text.trim()) parts.push(item.text.trim());
    return parts.length ? parts.join("\n\n") : "（子 Agent 通知）";
  }

  if (item.text.trim()) parts.push(item.text.trim());
  return parts.join("\n\n");
}

export function mergeAsyncPollIntoQueue(
  local: ChatQueueItem[],
  poll?: {
    running?: Array<{ jobId: string; taskLabel: string; subagentSessionId?: string; logs?: ChatQueueItem["logs"]; createdAt: number; sourceType?: string }>;
    queued?: Array<{
      jobId: string;
      taskLabel: string;
      position?: number;
      reason?: AsyncQueuedReason;
      gateBlock?: { approvalId: string; scope: string; reason?: string };
      subagentSessionId?: string;
      logs?: ChatQueueItem["logs"];
      createdAt: number;
      sourceType?: string;
    }>;
    deliveries?: Array<{
      id: string;
      jobId: string;
      taskLabel: string;
      asyncResult: string;
      status: "done" | "failed";
      error?: string;
      subagentSessionId?: string;
      subagentName?: string;
      logs?: ChatQueueItem["logs"];
      createdAt: number;
      pinned?: boolean;
      sourceType?: string;
    }>;
    consumed?: Array<{
      id: string;
      jobId: string;
      taskLabel: string;
      asyncResult: string;
      status: "done" | "failed";
      error?: string;
      subagentSessionId?: string;
      subagentName?: string;
      logs?: ChatQueueItem["logs"];
      createdAt: number;
      pinned?: boolean;
      sourceType?: string;
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
  // 服务端已消费（autoConsume 赢得 CLAIM）的 job → 完成态数据，供本地 overlay 纯派生转换
  const consumedByJobId = new Map<string, NonNullable<typeof poll.consumed>[number]>();
  for (const c of poll.consumed ?? []) consumedByJobId.set(c.jobId, c);

  const localByJobId = new Map(
    local.filter((i) => i.jobId).map((i) => [i.jobId!, i] as const),
  );

  // 本地已完成的 async-result overlay（带 removeAt）应继续展示到过期，并跳过 poll 重复投递
  const localFinishedOverlayIds = new Set<string>();

  // 本地 async-running overlay 被 poll 标记已消费时纯派生出的完成态展示项
  const derivedFinished: ChatQueueItem[] = [];

  let next = local.filter((item) => {
    if (item.kind === "user" || item.kind === "superior") return true;
    if (item.kind === "async-running" && item.jobId) {
      // 仍在 poll 活跃集（含 retry 重跑）：丢弃本地，由下方 poll 重建，避免分叉
      if (pollJobIds.has(item.jobId)) return false;
      // 前端已消费（本地标记）：完成态由 consume 路径的 patchAsyncOverlays 负责；
      // retry 场景等 poll 活跃集重建，不能在此滞留旧完成态
      if (skipDeliveries.has(item.jobId)) return false;
      // overlay 生命周期结束（createdAt + 15s）：无论是否完成都不再展示
      if (Date.now() - item.createdAt >= 15_000) return false;
      // poll 显示已被服务端消费（autoConsume 赢得原子 CLAIM 的常态场景）：
      // 不变量——本地 overlay 必须转为 done/failed 完成态继续展示到生命周期结束，
      // 而不是静默丢弃。「任务完成后进度步骤保留展示」不依赖前端赢得 CLAIM 竞态。
      // 纯派生（removeAt 由 createdAt 决定，不取 Date.now()，render 幂等）。
      const del = consumedByJobId.get(item.jobId);
      if (del) {
        derivedFinished.push({
          ...item,
          id: `run-${item.jobId}`,
          kind: "async-result",
          status: del.status,
          asyncResult:
            del.status === "failed" ? `任务失败：${del.error || "未知错误"}` : del.asyncResult,
          logs: del.logs ?? item.logs,
          removeAt: item.createdAt + 15_000,
          serverConsumed: true,
        });
        return false;
      }
      // poll 尚未跟上（工具刚返回）：保留运行态
      return true;
    }
    if (item.kind === "async-result" && item.jobId && item.removeAt && Date.now() < item.removeAt) {
      localFinishedOverlayIds.add(item.jobId);
      return true;
    }
    return false;
  });

  if (derivedFinished.length > 0) {
    next = [...derivedFinished, ...next];
  }

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
      logs: job.logs,
      createdAt: job.createdAt,
      sourceType: job.sourceType,
    });
  }

  for (const job of poll.queued ?? []) {
    if (next.some((q) => q.jobId === job.jobId)) continue;
    next.unshift({
      id: `queued-${job.jobId}`,
      kind: "async-running",
      text: "",
      jobId: job.jobId,
      taskLabel: job.taskLabel,
      status: "queued",
      queuePosition: job.position,
      queuedReason: job.reason,
      gateBlock: job.gateBlock,
      subagentSessionId: job.subagentSessionId,
      logs: job.logs,
      createdAt: job.createdAt,
      sourceType: job.sourceType,
    });
  }

  for (const del of poll.deliveries ?? []) {
    if (skipDeliveries.has(del.jobId)) continue;
    // 本地已完成 overlay 仍在展示窗口内，跳过 poll delivery 避免重复消费/闪烁
    if (localFinishedOverlayIds.has(del.jobId)) continue;
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
      logs: del.logs ?? prev?.logs,
      createdAt: del.createdAt,
      pinned: del.pinned ?? prev?.pinned,
      sourceType: del.sourceType ?? prev?.sourceType,
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
  const userItems = merged.filter(
    (i) => i.kind === "user" || i.kind === "superior" || i.kind === "child_notify",
  );
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
  const userQueue = merged.filter(
    (i) => i.kind === "user" || i.kind === "superior" || i.kind === "child_notify",
  );
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
  opts?: { skillId?: string; skillPrompt?: string; attachments?: ChatQueueAttachment[]; dbId?: string },
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
    dbId: opts?.dbId,
    source: "user",
  };
}

/** DB SessionQueueItem 行形状（list / SSE 合并共用） */
export type SessionQueueItemRow = {
  id: string;
  kind: string;
  content: string;
  source: string;
  sourceName?: string | null;
  agentMessageId?: string | null;
  order: number;
  attachments?: unknown;
  skillId?: string | null;
  skillPrompt?: string | null;
  createdAt: string | Date | number;
};

/** 把 DB SessionQueueItem 转成前端 ChatQueueItem */
export function sessionQueueItemToChatItem(row: SessionQueueItemRow): ChatQueueItem {
  const createdAt =
    typeof row.createdAt === "number"
      ? row.createdAt
      : row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : new Date(row.createdAt).getTime();
  const kind: ChatQueueItemKind =
    row.kind === "superior" ? "superior" : row.kind === "child_notify" ? "child_notify" : "user";
  return {
    id: row.kind === "superior" ? `sup-${row.id}` : row.kind === "child_notify" ? `cn-${row.id}` : `q-${row.id}`,
    kind,
    text: row.content,
    status: "pending",
    skillId: row.skillId ?? undefined,
    skillPrompt: row.skillPrompt ?? undefined,
    attachments: Array.isArray(row.attachments) ? (row.attachments as ChatQueueAttachment[]) : undefined,
    createdAt,
    dbId: row.id,
    agentMessageId: row.agentMessageId ?? undefined,
    source: row.source,
    sourceName: row.sourceName ?? undefined,
  };
}

/**
 * 用 DB 列表幂等合并本地发送队列：
 * - 有 dbId 的项以 DB 为事实源（增/改/删随 list 对齐）
 * - 尚无 dbId 的本地乐观项保留（用户刚入队、mutation 未回）
 * 解决「每会话只水合一次 → 不刷新看不见队列 / 空首包锁死」。
 */
export function mergeUserQueueFromDb(
  local: ChatQueueItem[],
  dbRows: SessionQueueItemRow[],
): ChatQueueItem[] {
  const dbItems = dbRows.map(sessionQueueItemToChatItem);
  const localOnly = local.filter((i) => !i.dbId);
  return [...dbItems, ...localOnly];
}
