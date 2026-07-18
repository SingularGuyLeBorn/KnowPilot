/**
 * ask_user 挂起/唤醒 + 未回复提醒 + SQLite 持久化
 *
 * 不变量：
 * - 内存 Map = 热路径；AskUserRequest 表 = 重启真相源
 * - waitAskUserResolution 挂 Promise；resolveAskUser / TTL / abort 唤醒
 * - 重启后 hydrate 恢复 pending+提醒；无 waiter 时的答复 → 入会话发送队列（孤儿投递）
 */

import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { sendEmailNotification } from "./emailNotifier.js";
import type { ServiceContainer } from "./serviceContainer.js";

export type AskUserChannel = "ui" | "email";

export type AskUserResolution = {
  outcome: "answered" | "expired" | "aborted";
  askId: string;
  answer?: string;
  source?: "ui" | "email" | "timeout" | "abort";
};

export type AskUserPending = {
  askId: string;
  sessionId: string;
  question: string;
  options?: string[];
  channel: AskUserChannel;
  subject: string;
  agentId?: string;
  messageId?: string;
  threadId?: string;
  createdAt: number;
  reminderCount: number;
  status: "pending" | "resolved";
  resolution?: AskUserResolution;
};

interface AskUserWaiter {
  resolve: (r: AskUserResolution) => void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const pendingById = new Map<string, AskUserPending>();
const waitersById = new Map<string, Set<AskUserWaiter>>();
const byMessageId = new Map<string, string>();
const byThreadId = new Map<string, string>();
const processedEventIds = new Set<string>();

type ReminderHandles = {
  firstTimer?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  config: AppConfig;
  log?: ServiceContainer["log"];
};
const remindersById = new Map<string, ReminderHandles>();

/** hydrate 后用于孤儿投递 / 落库 */
let persistServices: ServiceContainer | null = null;
let persistConfig: AppConfig | null = null;

function firstReminderMs(): number {
  const raw = Number(process.env.ASK_USER_FIRST_REMINDER_MS || "");
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

function repeatReminderMs(): number {
  const raw = Number(process.env.ASK_USER_REPEAT_REMINDER_MS || "");
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

function askTtlMs(): number {
  const raw = Number(process.env.ASK_USER_TTL_MS || process.env.APPROVAL_PENDING_TTL_MS || "");
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

async function getPrisma() {
  const { prisma } = await import("../db.js");
  return prisma;
}

function removeWaiter(askId: string, waiter: AskUserWaiter): void {
  if (waiter.timer) clearTimeout(waiter.timer);
  if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
  const set = waitersById.get(askId);
  if (set) {
    set.delete(waiter);
    if (set.size === 0) waitersById.delete(askId);
  }
}

function clearReminders(askId: string): void {
  const handles = remindersById.get(askId);
  if (!handles) return;
  if (handles.firstTimer) clearTimeout(handles.firstTimer);
  if (handles.interval) clearInterval(handles.interval);
  remindersById.delete(askId);
}

async function persistCreate(pending: AskUserPending): Promise<void> {
  try {
    const prisma = await getPrisma();
    await prisma.askUserRequest.create({
      data: {
        id: pending.askId,
        sessionId: pending.sessionId,
        agentId: pending.agentId,
        question: pending.question,
        options: pending.options ?? undefined,
        channel: pending.channel,
        subject: pending.subject,
        messageId: pending.messageId,
        threadId: pending.threadId,
        status: "pending",
        reminderCount: 0,
        createdAt: new Date(pending.createdAt),
      },
    });
  } catch (err) {
    console.warn(
      `[askUserGate] 落库 create 失败 askId=${pending.askId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function persistResolve(askId: string, resolution: AskUserResolution, reminderCount: number): Promise<void> {
  try {
    const prisma = await getPrisma();
    await prisma.askUserRequest.updateMany({
      where: { id: askId, status: "pending" },
      data: {
        status: "resolved",
        answer: resolution.answer,
        resolution: resolution.outcome,
        source: resolution.source,
        reminderCount,
        resolvedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn(`[askUserGate] 落库 resolve 失败 askId=${askId}:`, err instanceof Error ? err.message : err);
  }
}

async function persistReminderCount(askId: string, reminderCount: number): Promise<void> {
  try {
    const prisma = await getPrisma();
    await prisma.askUserRequest.updateMany({
      where: { id: askId, status: "pending" },
      data: { reminderCount },
    });
  } catch {
    /* ignore */
  }
}

async function persistMailIds(askId: string, ids: { messageId?: string; threadId?: string }): Promise<void> {
  try {
    const prisma = await getPrisma();
    await prisma.askUserRequest.updateMany({
      where: { id: askId, status: "pending" },
      data: {
        ...(ids.messageId ? { messageId: ids.messageId } : {}),
        ...(ids.threadId ? { threadId: ids.threadId } : {}),
      },
    });
  } catch {
    /* ignore */
  }
}

/** 无 waiter（重启后）时：把答复写入会话发送队列，由既有 drain 起轮 */
async function deliverOrphanAskAnswer(
  pending: AskUserPending,
  resolution: AskUserResolution,
): Promise<void> {
  if (resolution.outcome !== "answered" || !resolution.answer) return;
  const services = persistServices;
  if (!services?.sessionQueueItem?.create) {
    console.warn(`[askUserGate] 孤儿答复无法入队（services 未注入）askId=${pending.askId}`);
    return;
  }
  try {
    const content = buildAskUserResumeMessage(resolution);
    await services.sessionQueueItem.create({
      sessionId: pending.sessionId,
      kind: "user",
      content,
      source: "ask_user",
      sourceName: resolution.source === "email" ? "邮件答复" : "用户答复",
    });
    console.info(`[askUserGate] 孤儿答复已入队 session=${pending.sessionId} askId=${pending.askId}`);
  } catch (err) {
    console.warn(
      `[askUserGate] 孤儿答复入队失败 askId=${pending.askId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function sendReminderEmail(askId: string): Promise<void> {
  const pending = pendingById.get(askId);
  const handles = remindersById.get(askId);
  if (!pending || pending.status !== "pending" || !handles) return;

  pending.reminderCount += 1;
  void persistReminderCount(askId, pending.reminderCount);

  const mins = Math.round((Date.now() - pending.createdAt) / 60000);
  const optionsBlock =
    pending.options && pending.options.length > 0
      ? `\n选项：\n${pending.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n`
      : "";
  const channelHint =
    pending.channel === "email"
      ? "请回复原询问邮件，或在 KnowPilot Chat 弹框中作答。"
      : "请打开 KnowPilot Chat，在 ask_user 弹框中作答。";

  const result = await sendEmailNotification(handles.config, handles.log, {
    subject: `[KnowPilot 提醒] 请回复 Agent 提问（已等待 ${mins} 分钟）`,
    body:
      `Agent 正在等待你的回复（第 ${pending.reminderCount} 次提醒）。\n\n` +
      `问题：${pending.question}\n` +
      optionsBlock +
      `\n会话：${pending.sessionId}\naskId：${askId}\n\n` +
      `${channelHint}\n`,
    agentId: pending.agentId,
  });

  if ("error" in result) {
    console.warn(`[askUserGate] 提醒未发送 askId=${askId}: ${result.error}`);
  }
}

function scheduleReminders(
  askId: string,
  config: AppConfig,
  log?: ServiceContainer["log"],
  opts?: { elapsedMs?: number },
): void {
  clearReminders(askId);
  const handles: ReminderHandles = { config, log };
  remindersById.set(askId, handles);

  const elapsed = opts?.elapsedMs ?? 0;
  const firstDelay = Math.max(0, firstReminderMs() - elapsed);

  handles.firstTimer = setTimeout(() => {
    void sendReminderEmail(askId).then(() => {
      const still = remindersById.get(askId);
      const pending = pendingById.get(askId);
      if (!still || !pending || pending.status !== "pending") return;
      still.interval = setInterval(() => {
        void sendReminderEmail(askId);
      }, repeatReminderMs());
    });
  }, firstDelay);
}

function finishAsk(askId: string, resolution: AskUserResolution): void {
  const pending = pendingById.get(askId);
  const hadWaiters = (waitersById.get(askId)?.size ?? 0) > 0;
  if (pending) {
    pending.status = "resolved";
    pending.resolution = resolution;
    void persistResolve(askId, resolution, pending.reminderCount);
  }
  clearReminders(askId);

  const set = waitersById.get(askId);
  if (set) {
    for (const waiter of [...set]) {
      removeWaiter(askId, waiter);
      waiter.resolve(resolution);
    }
  }

  // 重启后无挂起 run：答复仍进会话队列，由 drain 续跑
  if (!hadWaiters && pending && resolution.outcome === "answered") {
    void deliverOrphanAskAnswer(pending, resolution);
  }
}

export async function createAskUserPending(input: {
  sessionId: string;
  question: string;
  options?: string[];
  channel: AskUserChannel;
  subject?: string;
  agentId?: string;
  messageId?: string;
  threadId?: string;
  config: AppConfig;
  log?: ServiceContainer["log"];
}): Promise<AskUserPending> {
  const askId = randomUUID();
  const pending: AskUserPending = {
    askId,
    sessionId: input.sessionId,
    question: input.question.trim(),
    options: input.options?.map((o) => String(o).trim()).filter(Boolean),
    channel: input.channel,
    subject: (input.subject || `KnowPilot 需要你的确认`).trim(),
    agentId: input.agentId,
    messageId: input.messageId,
    threadId: input.threadId,
    createdAt: Date.now(),
    reminderCount: 0,
    status: "pending",
  };
  pendingById.set(askId, pending);
  if (pending.messageId) byMessageId.set(pending.messageId, askId);
  if (pending.threadId) byThreadId.set(pending.threadId, askId);
  scheduleReminders(askId, input.config, input.log);
  await persistCreate(pending);
  return pending;
}

export function bindAskUserMailIds(
  askId: string,
  ids: { messageId?: string; threadId?: string },
): void {
  const pending = pendingById.get(askId);
  if (!pending || pending.status !== "pending") return;
  if (ids.messageId) {
    pending.messageId = ids.messageId;
    byMessageId.set(ids.messageId, askId);
  }
  if (ids.threadId) {
    pending.threadId = ids.threadId;
    byThreadId.set(ids.threadId, askId);
  }
  void persistMailIds(askId, ids);
}

export function getAskUserPending(askId: string): AskUserPending | undefined {
  return pendingById.get(askId);
}

export function listAskUserPendingForSession(sessionId: string): AskUserPending[] {
  return [...pendingById.values()].filter(
    (p) => p.sessionId === sessionId && p.status === "pending",
  );
}

export function listAllAskUserPending(): AskUserPending[] {
  return [...pendingById.values()].filter((p) => p.status === "pending");
}

export function resolveAskUser(
  askId: string,
  answer: string,
  source: "ui" | "email" = "ui",
): { ok: true; resolution: AskUserResolution } | { ok: false; reason: string } {
  const pending = pendingById.get(askId);
  if (!pending) return { ok: false, reason: "askId 不存在或已失效" };
  if (pending.status !== "pending") return { ok: false, reason: "该提问已结束" };
  const text = answer.trim();
  if (!text) return { ok: false, reason: "答复不能为空" };

  const resolution: AskUserResolution = {
    outcome: "answered",
    askId,
    answer: text,
    source,
  };
  finishAsk(askId, resolution);
  return { ok: true, resolution };
}

export function resolveAskUserFromMail(input: {
  eventId?: string;
  inReplyTo?: string | null;
  threadId?: string | null;
  text: string;
}): { ok: true; askId: string } | { ok: false; reason: string } {
  if (input.eventId) {
    if (processedEventIds.has(input.eventId)) {
      return { ok: false, reason: "event 已处理（幂等）" };
    }
    processedEventIds.add(input.eventId);
    if (processedEventIds.size > 2000) {
      const first = processedEventIds.values().next().value;
      if (first) processedEventIds.delete(first);
    }
  }

  let askId: string | undefined;
  if (input.inReplyTo) askId = byMessageId.get(input.inReplyTo);
  if (!askId && input.threadId) askId = byThreadId.get(input.threadId);
  if (!askId) return { ok: false, reason: "未找到对应的 ask_user pending" };

  const result = resolveAskUser(askId, input.text, "email");
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, askId };
}

export async function waitAskUserResolution(
  askId: string,
  opts?: { signal?: AbortSignal },
): Promise<AskUserResolution> {
  const pending = pendingById.get(askId);
  if (!pending) {
    return { outcome: "expired", askId, source: "timeout" };
  }
  if (pending.status !== "pending") {
    return pending.resolution ?? { outcome: "expired", askId, source: "timeout" };
  }

  return new Promise<AskUserResolution>((resolve) => {
    const waiter: AskUserWaiter = { resolve };

    const ttl = askTtlMs();
    const elapsed = Date.now() - pending.createdAt;
    const remain = Math.max(0, ttl - elapsed);
    waiter.timer = setTimeout(() => {
      if (pendingById.get(askId)?.status === "pending") {
        finishAsk(askId, { outcome: "expired", askId, source: "timeout" });
      }
    }, remain);

    if (opts?.signal) {
      waiter.signal = opts.signal;
      waiter.onAbort = () => {
        if (pendingById.get(askId)?.status === "pending") {
          finishAsk(askId, { outcome: "aborted", askId, source: "abort" });
        }
      };
      if (opts.signal.aborted) {
        waiter.onAbort();
        return;
      }
      opts.signal.addEventListener("abort", waiter.onAbort, { once: true });
    }

    let set = waitersById.get(askId);
    if (!set) {
      set = new Set();
      waitersById.set(askId, set);
    }
    set.add(waiter);
  });
}

export function buildAskUserResumeMessage(resolution: AskUserResolution): string {
  if (resolution.outcome === "answered") {
    const via =
      resolution.source === "email" ? "（邮件回复）" : resolution.source === "ui" ? "（Chat 弹框）" : "";
    return `用户已答复 ask_user${via}（askId=${resolution.askId}）：\n${resolution.answer}\n请基于该答复继续完成任务，不要重复追问同一问题（除非用户要求澄清）。`;
  }
  if (resolution.outcome === "aborted") {
    return `ask_user 等待被中止（askId=${resolution.askId}）。请向用户说明并收尾，或改用其他方案。`;
  }
  return `ask_user 等待超时，用户未在时限内答复（askId=${resolution.askId}）。请向用户说明并收尾，或改用其他不需要用户确认的方案。`;
}

/** 启动时从 SQLite 灌回内存 pending，并重挂提醒 */
export async function hydrateAskUserGateFromDb(
  config: AppConfig,
  services: ServiceContainer,
): Promise<number> {
  persistConfig = config;
  persistServices = services;
  try {
    const prisma = await getPrisma();
    const rows = await prisma.askUserRequest.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    let n = 0;
    for (const row of rows) {
      if (pendingById.has(row.id)) continue;
      const options = Array.isArray(row.options)
        ? (row.options as unknown[]).map((o) => String(o))
        : undefined;
      const pending: AskUserPending = {
        askId: row.id,
        sessionId: row.sessionId,
        question: row.question,
        options,
        channel: row.channel === "email" ? "email" : "ui",
        subject: row.subject,
        agentId: row.agentId ?? undefined,
        messageId: row.messageId ?? undefined,
        threadId: row.threadId ?? undefined,
        createdAt: row.createdAt.getTime(),
        reminderCount: row.reminderCount,
        status: "pending",
      };
      pendingById.set(pending.askId, pending);
      if (pending.messageId) byMessageId.set(pending.messageId, pending.askId);
      if (pending.threadId) byThreadId.set(pending.threadId, pending.askId);
      const elapsed = Date.now() - pending.createdAt;
      if (elapsed >= askTtlMs()) {
        finishAsk(pending.askId, { outcome: "expired", askId: pending.askId, source: "timeout" });
      } else {
        scheduleReminders(pending.askId, config, services.log, { elapsedMs: elapsed });
      }
      n += 1;
    }
    if (n > 0) console.info(`[askUserGate] 已从 DB 恢复 ${n} 条 pending ask_user`);
    return n;
  } catch (err) {
    console.warn(
      `[askUserGate] hydrate 失败（若尚未 db:push AskUserRequest 表可忽略）:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

export function __resetAskUserGateForTests(): void {
  for (const askId of [...remindersById.keys()]) clearReminders(askId);
  for (const [askId, set] of waitersById) {
    for (const w of [...set]) removeWaiter(askId, w);
  }
  pendingById.clear();
  waitersById.clear();
  byMessageId.clear();
  byThreadId.clear();
  processedEventIds.clear();
  persistServices = null;
  persistConfig = null;
}

export function __getAskUserReminderCountForTests(askId: string): number {
  return pendingById.get(askId)?.reminderCount ?? 0;
}
