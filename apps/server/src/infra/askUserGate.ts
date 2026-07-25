/**
 * ask_user 挂起/唤醒 + 未回复提醒 + SQLite 持久化
 *
 * 不变量：
 * - 内存 Map = 热路径；AskUserRequest 表 = 重启真相源
 * - waitAskUserResolution 挂 Promise；resolveAskUser / TTL / abort 唤醒
 * - 重启后 hydrate 恢复 pending+提醒；无 waiter 时的答复 → 入会话发送队列（孤儿投递）
 * - 同步临界区：pending 状态检查与 waiter 注册之间无 await（内存 Map 可读），与 approvalGate
 *   「注册先行、对账在后」同一不变量（approval 因真相源在 DB 而先注册再 await 复读）
 *
 * A6 与 approvalGate 语义对照（保留各自语义，不对齐实现）：
 * - ask_user abort：resolve outcome=aborted → 注入「被中止」续轮让 LLM 收尾
 * - approval abort：reject AbortError → run 走 failed（危险操作中止不假装完成）
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

type ReminderHandles = {
  timer?: ReturnType<typeof setTimeout>;
  config: AppConfig;
  log?: ServiceContainer["log"];
};
const remindersById = new Map<string, ReminderHandles>();

/** hydrate 后用于孤儿投递 / 落库 */
let persistServices: ServiceContainer | null = null;
let persistConfig: AppConfig | null = null;

/**
 * ask_user 提醒邮件阶梯节奏（从 ask_user 创建起算，每档间隔）：
 *   第 1 次：1 分钟后
 *   第 2 次：再 10 分钟后
 *   第 3 次：再 30 分钟后
 *   第 4 次：再 30 分钟后
 *   第 5 次起：每 1 小时（固定），直到用户回复 / 超时 / 中止
 * 超出数组长度后用最后一档（1 小时）兜底，保证「固定一小时直到回复」。
 * env ASK_USER_REMINDER_LADDER_MS 可整体覆盖（逗号分隔毫秒数，测试用，如 10000 = 每档 10s）。
 */
const DEFAULT_REMINDER_LADDER_MS = [
  1 * 60 * 1000, // 1min
  10 * 60 * 1000, // 10min
  30 * 60 * 1000, // 30min
  30 * 60 * 1000, // 30min
  60 * 60 * 1000, // 1h（固定兜底）
];

function parseReminderLadder(): number[] {
  const raw = process.env.ASK_USER_REMINDER_LADDER_MS?.trim();
  if (!raw) return DEFAULT_REMINDER_LADDER_MS;
  const parts = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parts.length > 0 ? parts : DEFAULT_REMINDER_LADDER_MS;
}

function reminderIntervalFor(count: number): number {
  const ladder = parseReminderLadder();
  return ladder[Math.min(count, ladder.length - 1)]!;
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
  if (handles.timer) clearTimeout(handles.timer);
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

  // 提醒邮件 = 可回复邮件：用户可直接回复本邮件，回复内容作为 customResponse 注入回 session 发给大模型。
  // 用 sendEmailNotification 发送（agentmail 通道返回 messageId/threadId），绑定回 pending，
  // 这样 webhook/poller 收到回复时能通过 inReplyTo/threadId 匹配回 askId。
  const result = await sendEmailNotification(handles.config, handles.log, {
    subject: `[KnowPilot 需回复] Agent 正在等你回复（已等待 ${mins} 分钟）`,
    body:
      `Agent 正在等待你的回复（第 ${pending.reminderCount} 次提醒）。\n\n` +
      `问题：${pending.question}\n` +
      optionsBlock +
      `\n会话：${pending.sessionId}\naskId：${askId}\n\n` +
      `直接回复本邮件即可，回复内容会作为你的答复发给 Agent（和聊天框打字等价）。\n` +
      `你也可以打开 KnowPilot Chat 在 ask_user 弹框中作答。\n`,
    agentId: pending.agentId,
  });

  if ("error" in result) {
    console.warn(`[askUserGate] 提醒邮件未发送 askId=${askId}: ${result.error}`);
    return;
  }

  // 绑定本封提醒邮件的 messageId/threadId 到 pending，用户回复本邮件即可匹配回 askId
  if (result.messageId || result.threadId) {
    bindAskUserMailIds(askId, { messageId: result.messageId, threadId: result.threadId });
    console.info(
      `[askUserGate] 提醒邮件已发送并绑定 askId=${askId} messageId=${result.messageId} threadId=${result.threadId}（用户可直接回复本邮件）`,
    );
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
  const pending = pendingById.get(askId);
  // 已发 reminderCount 次 → 下次是第 reminderCount+1 次，用 ladder[reminderCount] 档
  const count = pending?.reminderCount ?? 0;
  const interval = reminderIntervalFor(count);
  // elapsed 是从创建起算的总耗时；若已超过当前档，立即补发（delay=0）
  const delay = Math.max(0, interval - elapsed);

  const fire = (): void => {
    void sendReminderEmail(askId).then(() => {
      const still = remindersById.get(askId);
      const p = pendingById.get(askId);
      if (!still || !p || p.status !== "pending") return;
      // sendReminderEmail 已把 reminderCount+1；下次用 ladder[新 reminderCount] 档
      const nextInterval = reminderIntervalFor(p.reminderCount);
      still.timer = setTimeout(fire, nextInterval);
    });
  };

  handles.timer = setTimeout(fire, delay);
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
}): { ok: true; askId: string; answer: string } | { ok: false; reason: string } {
  // event_id 幂等已收至 DB（ProcessedWebhookEvent 表，见 webhookIdempotency.ts claimWebhookEvent），
  // 入口（webhook handler / poller）消费前已抢占；此处不再做内存去重，避免双轨。
  // 下游 resolveAskUser 的 pending.status 保护是第二道防线（跨通道重复也拒）。

  let askId: string | undefined;
  if (input.inReplyTo) askId = byMessageId.get(input.inReplyTo);
  if (!askId && input.threadId) askId = byThreadId.get(input.threadId);
  if (!askId) return { ok: false, reason: "未找到对应的 ask_user pending" };

  const result = resolveAskUser(askId, input.text, "email");
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, askId, answer: input.text };
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

/**
 * 会话 resume（服务重启后）时：若仍有未答复的 ask_user，注入引导文案，
 * 避免盲目「继续任务」导致重复调用 ask_user。
 * 无 pending → 返回 null（调用方用默认恢复文案）。
 */
export function buildResumeHintIfAskPending(sessionId: string): string | null {
  const pending = listAskUserPendingForSession(sessionId);
  if (pending.length === 0) return null;
  const lines = pending.map((p, i) => {
    const q = p.question.length > 160 ? `${p.question.slice(0, 160)}…` : p.question;
    const ch = p.channel === "email" ? "邮件/Chat" : "Chat 弹框";
    return `${i + 1}. askId=${p.askId}（经 ${ch}）\n   问题：${q}`;
  });
  return (
    `（服务已重启。本会话仍有 ${pending.length} 个未答复的 ask_user，请勿重复调用 ask_user；` +
    `等待用户在弹框或邮件中答复后，再基于答复继续任务。）\n\n` +
    `待答复列表：\n${lines.join("\n")}`
  );
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
  persistServices = null;
  persistConfig = null;
}

export function __getAskUserReminderCountForTests(askId: string): number {
  return pendingById.get(askId)?.reminderCount ?? 0;
}
