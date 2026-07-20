/**
 * 异步 Agent 任务执行层。
 *
 * 不变量（由本文件强制，调用方不依赖时序自觉）：
 * - v7 通道收敛：deliverToQueue 决定结果唯一通道（true→异步队列+原子 CLAIM；false→tool return）。
 * - v8 全局任务池：Q2 占用口径 = 池内 running + hub 交互 running；Q4 血缘让渡 inline 不占新槽。
 * - v9 投递可靠性：R-1 原子 CLAIM + 同链即时回滚 + reconciler 对账 + runStartupRecovery 四动作。
 * - v10 可重入续跑：reentrant 按工具注册表取最严、retryCount 先落库、maxRetries 防 crash-loop。
 *
 * 数据持久化到 Task 表；执行调度收口到 asyncJobOrchestrator。
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { runAgentLoop } from "./agentRuntime.js";
import { runAgentLoopStream, chatAgentStream, type AgentStreamEvent } from "./agentStream.js";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  executeToolCallsBatch,
  createAgentToolContext,
  type ToolRegistryEntry,
} from "./agentTools.js";
import type { LlmToolCall } from "./llmClient.js";
import { getStreamHub } from "./sessionStreamHub.js";
import type { StoredToolCall } from "./chatHistory.js";
import { waitMs } from "./shellRunner.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { prisma } from "../db.js";
import {
  getAsyncJobOrchestrator,
  consumeQueuedTimeoutMs,
  type AsyncJobQueuedReason,
} from "./asyncJobOrchestrator.js";
import { getSwarmOrchestrator } from "./swarmOrchestrator.js";
import { assertLlmBudget } from "./llmBudget.js";
import { getAllowedToolsForTier } from "./swarmPermissionGuard.js";
import {
  markAgentMessageDeliveredByTaskRef,
  rollbackAgentMessageDeliveredByTaskRef,
} from "./agentMessageLedger.js";
import { getTool } from "./tools/registry.js";
import { isAbortLikeError, messageFromAbortSignal } from "./abortReason.js";

export interface AsyncTaskLogEntry {
  timestamp: number;
  level: "info" | "progress" | "error";
  message: string;
}

export interface AsyncQueueDelivery {
  id: string;
  jobId: string;
  sessionId: string;
  taskLabel: string;
  asyncResult: string;
  status: "done" | "failed";
  error?: string;
  subagentSessionId?: string;
  subagentName?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  /** pinned 的结果不被自动 CLAIM，仅供前端展示 */
  pinned?: boolean;
  sourceType?: AsyncTaskSourceType;
}

export interface AsyncRunningJob {
  jobId: string;
  sessionId: string;
  taskLabel: string;
  status: "running";
  subagentSessionId?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  sourceType?: AsyncTaskSourceType;
}

const ASYNC_KIND = "async_agent";

export type AsyncTaskSourceType = "async_task_llm" | "async_task_tool" | "subagent" | "sleep";

interface AsyncTaskInput {
  kind: typeof ASYNC_KIND;
  sessionId: string;
  task: string;
  taskLabel: string;
  agentSnapshot: { id: string; model: string; systemPrompt: string; tools: string[]; tier?: string; parentId?: string | null; workspaceId?: string | null; name?: string | null };
  timeoutMs?: number;
  subagentSessionId?: string;
  /** v7 分类锚点：持久化层即区分 spawn_subagent / async_task_run / sleep，不依赖运行时推断。 */
  sourceType?: AsyncTaskSourceType;
  /** v7 纯工具路径：一次性的后台工具调用（不带 LLM），避免 async_task_run 再暴露 mode 参数。 */
  toolCall?: { tool: string; args: Record<string, unknown> };
  /** swarm 协作：任务结果额外广播到这些会话（共享给其他父会话） */
  shareToSessionIds?: string[];
  /**
   * v7 通道收敛锚点：true = 结果进异步队列，经原子 CLAIM 后 autoConsume 注入会话；
   * false = 结果走 tool return 直返父 Agent（如 waitForResult=true），永不进队列/气泡。
   * 默认 true。
   */
  deliverToQueue?: boolean;
}

interface AsyncTaskOutput {
  asyncResult?: string;
  error?: string;
  /** 任务 token 消耗（纳入 LLM 预算闭环，便于审计） */
  tokenUsage?: { prompt: number; completion: number; total: number };
  /** 执行过程中产生的进度/日志，供前端进度条与 LLM 状态查询使用 */
  logs?: AsyncTaskLogEntry[];
  /**
   * B1 投递豁免台账：true = 已原子认领 delivered 但故意不写会话气泡
   * （如 sleep/async_task_tool 失败）。reconciler Pass 1 识别后跳过，避免孤儿回滚循环。
   */
  deliveryExempt?: boolean;
}

function parseAsyncInput(raw: unknown): AsyncTaskInput | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const o = value as AsyncTaskInput;
  if (o.kind !== ASYNC_KIND || typeof o.sessionId !== "string") return null;
  return o;
}

/**
 * v10 可重入推断：物化到 Task.reentrant 列；唯一声明源 = 工具注册表 reentrant 字段，禁止再造列表。
 *
 * - mode "tool"：按 toolCall.tool 查注册表；查不到 = false（保守）。
 * - mode "llm"：agentSnapshot.tools 全体取最严——任一工具未声明 reentrant 或查不到
 *   （skill:* / mcp:* / 未知名，副作用未知一律保守）则整体 false；
 *   空数组 = true（纯 LLM 无工具，at-least-once 重跑最坏只是重新生成一遍回复）。
 * - 工具名归一化：注册表存裸名（web_search），Agent tools 可能带 native: 前缀，先剥前缀再查。
 */
export function inferTaskReentrant(input: {
  mode: "llm" | "tool";
  toolCall?: { tool: string; args: Record<string, unknown> };
  agentTools?: string[];
}): boolean {
  const lookup = (name: string): boolean => {
    const bare = name.startsWith("native:") ? name.slice("native:".length) : name;
    return getTool(bare)?.reentrant === true;
  };
  if (input.mode === "tool") {
    return input.toolCall ? lookup(input.toolCall.tool) : false;
  }
  const tools = input.agentTools ?? [];
  if (tools.length === 0) return true;
  return tools.every((t) => lookup(t));
}

function parseAsyncOutput(raw: unknown): AsyncTaskOutput {
  if (typeof raw === "string") {
    try {
      return (JSON.parse(raw) ?? {}) as AsyncTaskOutput;
    } catch {
      return { asyncResult: raw };
    }
  }
  return (raw ?? {}) as AsyncTaskOutput;
}

function toDelivery(task: {
  id: string;
  input: unknown;
  output: unknown;
  status: string;
  createdAt: Date;
  pinned?: number | boolean;
}): AsyncQueueDelivery | null {
  const input = parseAsyncInput(task.input);
  if (!input) return null;
  const output = parseAsyncOutput(task.output);
  const failed = task.status === "failed";
  const pinned = task.pinned === true || task.pinned === 1;
  return {
    id: `del-${task.id}`,
    jobId: task.id,
    sessionId: input.sessionId,
    taskLabel: input.taskLabel,
    asyncResult: failed ? "" : output.asyncResult || "(无文本输出)",
    status: failed ? "failed" : "done",
    error: output.error,
    subagentSessionId: input.subagentSessionId,
    subagentName: input.agentSnapshot?.name ?? undefined,
    logs: output.logs,
    createdAt: task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime(),
    pinned,
    sourceType: input.sourceType,
  };
}

/** 同一 session 的自动续跑串行化，避免多条 delivery 并发双跑 */
const sessionAutoConsumeChains = new Map<string, Promise<void>>();

/**
 * per-session 串行链：同会话的自动续跑（异步投递 / superior 队列 drain）全部串行。
 * 返回链 promise（含本次 work），供 waitForRun 等调用方等待「该次入队工作完成」。
 */
function enqueueSessionAutoConsume(sessionId: string, work: () => Promise<void>): Promise<void> {
  const prev = sessionAutoConsumeChains.get(sessionId) ?? Promise.resolve();
  // work 同挂 then 双分支 = 失败隔离：前序环节 reject 也必须继续跑本次，
  // 否则一条坏消息会毒死整条会话链（同会话后续投递全部永久阻塞）。
  const next = prev.then(work, work).finally(() => {
    // identity 比对后才删：本次执行期间新 work 可能已挂链尾（Map 里已是新链头），误删会砍断新链 → 并发双跑
    if (sessionAutoConsumeChains.get(sessionId) === next) {
      sessionAutoConsumeChains.delete(sessionId);
    }
  });
  sessionAutoConsumeChains.set(sessionId, next);
  return next;
}

/** superior 队列 drain 单次处理项（SessionQueueItem 的最小结构） */
export interface SuperiorQueueDrainItem {
  id: string;
  kind: string;
  content: string;
  /** 发送方 Agent id（superior 项）；R-2 启动恢复重建发送方上下文（注入消息 source 标识）用 */
  source?: string;
}

/**
 * W-E 服务端 superior 队列 drain：running 子 Agent 收到的上级消息先入持久队列
 *（SessionQueueItem，swarm.ts prepareAgentRun busy 分支写入），空闲时按 FIFO 自动续跑。
 * 复用 enqueueSessionAutoConsume 的 per-session 串行链——同会话的异步投递续跑与本 drain
 * 全部串行，「同会话同时至多一条流」不变量不破。
 *
 * 链上循环：hub.isRunning → waitFor；取队首（listBySession[0]，仅 claimedAt=null）；无则结束；
 * consume 软认领（置 claimedAt，落选 = 前端 drain 抢先，静默跳过看下一项）；
 * runItem 重入 prepareAgentRun（写消息、起流）；成功后 finalize 删行；抛错则保留 claimedAt 交恢复扫描。
 * 只处理 kind=superior 项：user 项归前端 drain 管（可能带附件/skill，服务端重放会丢语义），
 * 遇到即停——前端 drain 消费后会连带处理后续 superior 项；下次发消息也会重新注册本 drain。
 *
 * v8 TP-1 池准入：drain 续跑属「交付消费」高优通道（runConsumeJob 队首优先 + 全局占用约束）。
 * 不变量：禁止「等槽无限挂起消费链」——等槽超时则放弃本轮 drain，队列项未 claim、
 * 原样留在持久队列（不丢），下次触发（busy/idle 再入队或前端 drain）续上。
 * B2 不变量：队列项只能在内容已进 ChatMessage 之后消失（finalize）。
 *
 * 已知限制：链是进程内的，服务端重启后丢失；pending / 超龄 claimed 队列项跨重启留存于 SQLite，
 * 靠 runStartupRecovery 重置软认领 + requeueOrphanedSuperiorDrains，或下次发送 / 前端 drain 兜底。
 */
export function enqueueSuperiorQueueDrain(options: {
  sessionId: string;
  config: AppConfig;
  services: ServiceContainer;
  runItem: (item: SuperiorQueueDrainItem) => Promise<void>;
}): Promise<void> {
  const { sessionId, config, services, runItem } = options;
  return enqueueSessionAutoConsume(sessionId, async () => {
    const hub = getStreamHub();
    if (!hub) return;
    const orchestrator = getAsyncJobOrchestrator(config);
    try {
      for (;;) {
        if (hub.isRunning(sessionId)) {
          await hub.waitFor(sessionId);
          continue;
        }
        const head = (await services.sessionQueueItem.listBySession(sessionId))[0];
        if (!head) return;
        if (head.kind !== "superior") return;
        // 池准入放在 claim 之前：未获槽不 claim，队列项原样留待下次触发（不丢）
        const admitted = await orchestrator.runConsumeJob({
          jobId: `drain-${head.id}`,
          sessionId,
          queuedTimeoutMs: consumeQueuedTimeoutMs(config),
          execute: async () => {
            const claim = await services.sessionQueueItem.consume(head.id);
            if (!claim.claimed) return;
            // S2：认领后同步宣告「即将起流」——软认领到 runItem 内 hub.start 之间无 await 交错点
            hub.markRunStarting(sessionId);
            // Q2 不双算：drain 续跑流挂在池槽位下，不计入 hub 交互 running
            const releaseClaim = orchestrator.claimOccupancy(sessionId);
            try {
              await runItem({ id: head.id, kind: head.kind, content: head.content, source: head.source });
              // ChatMessage 已由 prepareAgentRun 写入（或 failed 路径终结）→ finalize 删行
              await services.sessionQueueItem.finalize(head.id);
            } catch (err) {
              console.warn(`[asyncJobManager] superior 队列 drain 处理失败 session=${sessionId} item=${head.id}:`, err);
              // 保留 claimedAt：启动恢复扫超龄后重置重投（B2 崩溃窗口可恢复）
            } finally {
              releaseClaim();
              hub.unmarkRunStarting(sessionId);
            }
          },
        });
        if (!admitted) {
          console.warn(
            `[asyncJobManager] superior 队列 drain 等槽超时放弃本轮 session=${sessionId} item=${head.id}（队列项未动，留待下次触发）`,
          );
          return;
        }
      }
    } catch (err) {
      console.warn(`[asyncJobManager] superior 队列 drain 异常 session=${sessionId}:`, err);
    }
  });
}

/**
 * v9 R-1 S3：delivered 条件写回滚（同链即时回滚与 reconciler 对账者共用的唯一回滚入口）。
 * `updateMany where delivered=true` 是与正常消费/前端 ack 竞态原子的互斥点：
 * - CLAIM 类写入（autoConsume / markAsyncDeliveryConsumed）只命中 delivered=false，
 *   与本回滚的条件互斥——同一行同一时刻至多一个写方生效，无丢失更新；
 * - 期间已被正常消费的记录条件写天然不命中（count=0），调用方据此放弃回滚。
 * 同事务回滚 W14 账本（delivered→pending），与 CLAIM 侧的 delivered 记账对称。
 * 返回是否回滚成功（false = 已被他人消费/回滚，调用方不得再补投）。
 */
async function rollbackAsyncDeliveryClaim(jobId: string): Promise<boolean> {
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.task.updateMany({
      where: { id: jobId, delivered: true },
      // deliveredAt 清空：交付事实上未完成，不保留伪时间；下次成功 CLAIM 重新落账
      data: { delivered: false, deliveredAt: null },
    });
    if (r.count > 0) {
      await rollbackAgentMessageDeliveredByTaskRef(tx, jobId);
    }
    return r;
  });
  return result.count > 0;
}

/**
 * 服务端自动消费异步结果：CLAIM → 注入消息 → 启动 Agent 续跑。
 * 不依赖前端是否打开该 session；与前端 consumeQueue 通过原子 CLAIM 竞态，先到者执行。
 */
export async function autoConsumeAsyncDelivery(options: {
  sessionId: string;
  jobId: string;
  status: "done" | "failed";
  taskLabel: string;
  services: ServiceContainer;
  config: AppConfig;
}): Promise<"skipped" | "started"> {
  const { sessionId, jobId, status, taskLabel, services, config } = options;

  const task = await prisma.task.findUnique({ where: { id: jobId } });
  if (!task) return "skipped";
  if (task.delivered || task.pinned) return "skipped";
  if (task.status !== "success" && task.status !== "failed") return "skipped";

  const input = parseAsyncInput(task.input);
  // v7 通道收敛：deliverToQueue=false 的结果已走 tool return 直返父 Agent，此处若放行 = 二次投喂
  if (input?.deliverToQueue === false) return "skipped";

  const failed = status === "failed" || task.status === "failed";
  // sleep / 纯工具失败：只留右栏 Task 看板，禁止灌进父会话气泡（否则 LLM 把错误当用户消息反复重试）。
  // 原子标记 delivered + output.deliveryExempt 台账——Pass 1 识别豁免，避免「无气泡=孤儿」回滚循环。
  const lightweightSource =
    input?.sourceType === "sleep" || input?.sourceType === "async_task_tool";
  if (failed && lightweightSource) {
    const prev = parseAsyncOutput(task.output);
    await prisma.task.updateMany({
      where: { id: jobId, delivered: false },
      data: {
        delivered: true,
        deliveredAt: new Date(),
        output: { ...prev, deliveryExempt: true },
      },
    });
    return "skipped";
  }

  const hub = getStreamHub();
  if (!hub) return "skipped";

  let session: { agentId?: string | null; status?: string | null; parentSessionId?: string | null; kind?: string | null } | null = null;
  try {
    session = await services.session.getByIdLite(sessionId);
  } catch {
    return "skipped";
  }
  if (!session?.agentId || session.status === "archived" || session.status === "deleted") {
    return "skipped";
  }

  const output = parseAsyncOutput(task.output);
  const message = failed
    ? `任务失败：${output.error || "未知错误"}`
    : output.asyncResult || "(无文本输出)";

  // 子任务会话（有 parentSessionId）上的异步续跑视为任务血统，允许 report_back
  const runOrigin =
    session.parentSessionId || session.kind === "subagent" || input?.sourceType === "sleep"
      ? ("parent" as const)
      : ("user" as const);

  // 投递时再读一次 Agent：优先 autoName（后台起名），避免角标冻住「子 Agent xxxx」占位名
  const snapshotAgentId = input?.agentSnapshot?.id;
  let resolvedSubagentName = input?.agentSnapshot?.name ?? taskLabel;
  if (snapshotAgentId) {
    try {
      const agentRow = await prisma.agent.findUnique({
        where: { id: snapshotAgentId },
        select: { autoName: true, name: true },
      });
      const display = agentRow?.autoName?.trim() || agentRow?.name?.trim();
      if (display) resolvedSubagentName = display;
    } catch {
      /* 读名失败仍用快照名 */
    }
  }

  const body = {
    sessionId,
    agentId: session.agentId as string,
    message,
    source: "sub" as const,
    runOrigin,
    // toolResults.subagentResult.jobId 是 reconciler 判孤儿的 ground truth 台账（json_extract 按此路径匹配）；
    // 字段形状改动必须同步对账查询，否则全体已注入记录被误判孤儿 → 回滚重投 = 重复投喂。
    toolResults: {
      subagentResult: {
        jobId,
        subagentSessionId: input?.subagentSessionId,
        subagentAgentId: snapshotAgentId,
        subagentName: resolvedSubagentName,
        sourceType: input?.sourceType ?? "async_task_llm",
        taskLabel,
      },
    },
  };

  const invokeTrpc = createTrpcInvoker({ services });

  // R-1 S3 第一层——同链即时回滚：CLAIM 之后注入失败的「确定未写消息」唯一路径是
  // startIfNotRunning 返回 false（别的流占线，runner/chatAgentStream 未执行，消息必然未写入）。
  // 该路径同事务回滚 delivered + W14 账本，并把 delivery 重挂消费链队尾（不丢、不重复）。
  // 其它失败一律不回滚（宁漏回滚勿错回滚）：如 started=true 后 chatAgentStream 中途抛错，
  // 消息可能已写入，回滚会导致重复投喂——交由 reconciler（第二层）以 ChatMessage 为 ground truth 对账。
  const consumeWork = async (): Promise<void> => {
    try {
      // B3：与 drain 对齐——hub.waitFor 在 runConsumeJob 之前（槽外等）。
      // 不变量：池槽只覆盖「执行」，不覆盖「等待起流条件」。
      if (hub.isRunning(sessionId)) {
        await hub.waitFor(sessionId);
      }
      // v8 TP-1：交付消费走高优池准入（队首优先 + 全局占用约束）。
      // 不变量：禁止「等槽无限挂起消费链」——等槽超时未获槽则放弃本轮；
      // CLAIM 在获槽后执行，未获槽则 delivered 保持 false，delivery 原样留待下次触发（不丢）。
      const orchestrator = getAsyncJobOrchestrator(config);
      let requeue = false;
      const admitted = await orchestrator.runConsumeJob({
        jobId: `consume-${jobId}`,
        sessionId,
        queuedTimeoutMs: consumeQueuedTimeoutMs(config),
        execute: async () => {
          // 获槽后再忙：禁止槽内 wait，重挂链尾（下轮再槽外 wait）
          if (hub.isRunning(sessionId)) {
            requeue = true;
            return;
          }
          // 获槽后才 CLAIM（W14：原子 CLAIM 与 AgentMessage 投递记账同事务——认领成功即完成对账，
          // 不存在「Task 已 delivered 但旁路邮箱仍 pending」的中间态。记账按 taskRef=jobId 幂等）。
          // 与前端 consumeQueue 竞态：落选方 count=0 静默跳过。
          const claimed = await prisma.$transaction(async (tx) => {
            const c = await tx.task.updateMany({
              where: { id: jobId, delivered: false, pinned: false },
              data: { delivered: true, deliveredAt: new Date() },
            });
            if (c.count > 0) {
              await markAgentMessageDeliveredByTaskRef(tx, jobId);
            }
            return c;
          });
          if (claimed.count === 0) return;

          // Q2 不双算：续跑流挂在池槽位下，不计入 hub 交互 running
          const releaseClaim = orchestrator.claimOccupancy(sessionId);
          try {
            const started = await hub.startIfNotRunning(sessionId, body, (emit, signal) =>
              chatAgentStream(services, config, body, invokeTrpc, emit, signal),
            );
            if (started === "started") {
              hub.pushExternalEvent(sessionId, {
                type: "session_run_started",
                sessionId,
                reason: "async_auto_consume",
                jobId,
              });
              // 槽位持有到续跑结束（与 spawn 池任务同口径）
              await hub.waitFor(sessionId);
            } else {
              // 被抢线（busy/duplicate）：消息确定未写入 → 条件写回滚并重挂链尾。
              // 回滚落选（false）= 期间已被正常消费/对账者处理，不得再补投。
              requeue = await rollbackAsyncDeliveryClaim(jobId);
              if (requeue) {
                console.warn(
                  `[asyncJobManager] autoConsume 被抢线（${started}），已回滚 delivered 并重挂链尾 session=${sessionId} job=${jobId}`,
                );
              }
            }
          } catch (err) {
            // 非「占线」异常（如 DB 抖动导致 start 抛错）：无法判定消息未写入，不回滚——
            // 交付保持 delivered=true，由 reconciler 对账兜底；此处仅留可观测日志。
            console.warn(
              `[asyncJobManager] autoConsume 起流异常 session=${sessionId} job=${jobId}（未回滚，留 reconciler 对账）:`,
              err,
            );
            throw err;
          } finally {
            releaseClaim();
          }
        },
      });
      if (!admitted) {
        console.warn(
          `[asyncJobManager] autoConsume 等槽超时放弃本轮 session=${sessionId} job=${jobId}（delivery 未 CLAIM，留待下次触发）`,
        );
        return;
      }
      if (requeue) {
        // 重挂消费链队尾：新一轮走完整高优通道（等 hub 空闲 → 再 CLAIM → 注入），不丢、不重复
        enqueueSessionAutoConsume(sessionId, consumeWork);
      }
    } catch (err) {
      console.warn(`[asyncJobManager] autoConsume 续跑失败 session=${sessionId} job=${jobId}:`, err);
    }
  };

  enqueueSessionAutoConsume(sessionId, consumeWork);

  return "started";
}

/** 任务终态后唯一通知入口：推 async_delivery 事件并触发服务端 autoConsume。绕过本函数会漏掉消费链与对账。 */
async function notifyAsyncDelivery(
  sessionId: string,
  jobId: string,
  status: "done" | "failed",
  taskLabel: string,
  services?: ServiceContainer,
  config?: AppConfig,
): Promise<void> {
  try {
    const hub = getStreamHub();
    if (hub) {
      hub.pushExternalEvent(sessionId, {
        type: "async_delivery",
        sessionId,
        jobId,
        status,
        taskLabel,
      });
    }
  } catch (err) {
    console.warn(`[asyncJobManager] notifyAsyncDelivery 失败:`, err);
  }

  if (services && config) {
    void autoConsumeAsyncDelivery({ sessionId, jobId, status, taskLabel, services, config }).catch((err) => {
      console.warn(`[asyncJobManager] autoConsumeAsyncDelivery 失败:`, err);
    });
  }
}

/** 供 report_back 等外部路径：推送 + 自动消费（与 finalizeSuccess 同源） */
export async function notifyAndAutoConsumeAsyncDelivery(options: {
  sessionId: string;
  jobId: string;
  status: "done" | "failed";
  taskLabel: string;
  services: ServiceContainer;
  config: AppConfig;
}): Promise<void> {
  await notifyAsyncDelivery(
    options.sessionId,
    options.jobId,
    options.status,
    options.taskLabel,
    options.services,
    options.config,
  );
}

/* -------------------------------------------------------------------------- */
/* R-1 S3 第二层：投递对账者（reconciler）
 *
 * 洞 S3：CLAIM（delivered=true + 账本 delivered）之后、气泡注入之前失败/重启 →
 * 「认领了但气泡没进会话」，结果永久丢失。第一层（同链即时回滚）只覆盖进程内可判定的
 * 抢线路径；进程重启、起流异常等无法即时判定的残留由本对账者兜底。
 *
 * 不变量（全部收在执行层，条件写原子，不靠时序自觉）：
 * 1. ChatMessage 是唯一 ground truth：会话里存在 toolResults.subagentResult.jobId=X 的
 *    气泡 = 已注入，零动作（正常已消费记录天然零误伤）；
 * 2. 回滚走 rollbackAsyncDeliveryClaim 条件写（delivered=true→false），与正常消费/前端 ack
 *    竞态原子——同一行同一时刻至多一个写方生效，幂等，连跑多轮结果一致；
 * 3. 补投重新走 notify/autoConsume 正常管道（与任务完成时同一入口），不另造投递路径；
 * 4. 宁漏勿错：deliveredAt 未超龄的记录视为「注入进行中」跳过（真孤儿下一轮再收），
 *    绝不误回滚在途交付。
 */

/** reconciler 每轮处理量上限（防爆库；剩余下一轮继续） */
export const RECONCILER_BATCH_LIMIT = 50;

/**
 * 孤儿判定超龄阈值：deliveredAt 距今不足该值的 delivered=true 记录视为注入进行中，本轮跳过。
 * CLAIM → 气泡落库正常在秒级完成，60s 足够保守；该阈值只影响补投时机，不影响正确性。
 */
export const RECONCILER_MIN_DELIVERED_AGE_MS = 60_000;

export interface ReconcileAsyncDeliveriesResult {
  /** 本轮扫描到的 delivered=true 终态候选数（含被过滤/跳过的） */
  scanned: number;
  /** 判定为孤儿并回滚成功的条数 */
  rolledBack: number;
  /** 回滚后重新 notify 的条数 */
  renotified: number;
  /** 已有气泡（ground truth 命中）跳过的条数 */
  skippedHasMessage: number;
  /** R-2 动作 2：本轮扫描到的 delivered=false 终态未投递候选数 */
  scannedUndelivered: number;
  /** R-2 动作 2：重新 notify 的未投递条数 */
  renotifiedUndelivered: number;
  /** R-2 动作 2：会话已删除/归档而跳过的条数（autoConsume 必然 skipped，避免每轮空转） */
  skippedSessionGone: number;
}

/**
 * 投递对账单轮（可测试），两条扫描同一幂等入口（不另造第二条恢复路径）：
 * Pass 1（R-1）：扫「delivered=true 且终态、超龄、未 pinned、deliverToQueue≠false，但会话
 *   消息里找不到 toolResults.subagentResult.jobId=X 气泡」的孤儿 → 条件写回滚 → 重新 notify。
 * Pass 2（R-2 动作 2）：扫「delivered=false 终态、超龄、未 pinned、deliverToQueue≠false」
 *   的未投递（重启丢失 notify / 消费链放弃后无再触发）→ 直接重新 notify。
 * 两条扫描共用 CLAIM 原子互斥与 notify/autoConsume 管道，全部动作幂等，可任意重跑。
 */
export async function reconcileAsyncDeliveries(options: {
  services: ServiceContainer;
  config: AppConfig;
  limit?: number;
  /** 测试可传 0 关闭超龄过滤；缺省 RECONCILER_MIN_DELIVERED_AGE_MS */
  minDeliveredAgeMs?: number;
}): Promise<ReconcileAsyncDeliveriesResult> {
  const { services, config } = options;
  const limit = Math.max(1, Math.min(options.limit ?? RECONCILER_BATCH_LIMIT, 500));
  const minAge = Math.max(0, options.minDeliveredAgeMs ?? RECONCILER_MIN_DELIVERED_AGE_MS);
  const cutoff = new Date(Date.now() - minAge);

  // 为什么 name 前缀 + type 双条件 OR：`[async-share]` 广播行 type=oneshot，只能靠 name 前缀扫到；
  // type=async_agent 则兜住命名不规范的存量/直建行。两个条件各管一类，缺一不可（下同）。
  const candidates = await prisma.task.findMany({
    where: {
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
      status: { in: ["success", "failed"] },
      delivered: true,
      pinned: false,
      deliveredAt: { lt: cutoff },
    },
    orderBy: { deliveredAt: "asc" },
    take: limit,
  });

  const result: ReconcileAsyncDeliveriesResult = {
    scanned: candidates.length,
    rolledBack: 0,
    renotified: 0,
    skippedHasMessage: 0,
    scannedUndelivered: 0,
    renotifiedUndelivered: 0,
    skippedSessionGone: 0,
  };

  for (const task of candidates) {
    const input = parseAsyncInput(task.input);
    // 同步任务（deliverToQueue=false）结果走 tool return，永不进气泡——不属于对账范围
    if (!input || input.deliverToQueue === false) continue;
    const sessionId = input.sessionId;

    // B1：deliveryExempt 台账 = 故意不写气泡的已认领交付（如轻量失败），不是孤儿
    if (parseAsyncOutput(task.output).deliveryExempt === true) continue;

    // ground truth：会话里是否已有携带该 jobId 台账的气泡（Prisma SQLite 不支持 JSON 路径过滤，
    // 用 json_extract 裸查；toolResults 为 NULL 时 json_extract 返回 NULL 天然不命中）
    const bubble = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ChatMessage"
      WHERE sessionId = ${sessionId}
        AND json_extract(toolResults, '$.subagentResult.jobId') = ${task.id}
      LIMIT 1
    `;
    if (bubble.length > 0) {
      result.skippedHasMessage++;
      continue;
    }

    // 孤儿：条件写回滚（同事务回滚 W14 账本）。落选 = 期间已被正常消费/并行对账处理，跳过
    const rolledBack = await rollbackAsyncDeliveryClaim(task.id);
    if (!rolledBack) continue;
    result.rolledBack++;
    console.warn(`[reconciler] 补投 jobId=${task.id} session=${sessionId}（delivered 回滚，重新走 notify/autoConsume 管道）`);
    await notifyAsyncDelivery(
      sessionId,
      task.id,
      task.status === "failed" ? "failed" : "done",
      input.taskLabel,
      services,
      config,
    );
    result.renotified++;
  }

  /* ── Pass 2（R-2 动作 2）：delivered=false 终态未投递 → 直接重新 notify ──
   * 与 Pass 1 同一幂等入口：认领由 Task.delivered 原子 CLAIM 互斥（重复 notify 不重复投递）；
   * 超龄阈值同在途保护——刚完成的任务 notify 在途，本轮跳过、真丢失下一轮再收（宁漏勿错）。 */
  const undelivered = await prisma.task.findMany({
    where: {
      AND: [
        { OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }] },
        // 终态时间超龄：finishedAt 优先；老数据 finishedAt 可能为 NULL 时回退 createdAt
        { OR: [{ finishedAt: { lt: cutoff } }, { finishedAt: null, createdAt: { lt: cutoff } }] },
      ],
      status: { in: ["success", "failed"] },
      delivered: false,
      pinned: false,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  result.scannedUndelivered = undelivered.length;
  for (const task of undelivered) {
    const input = parseAsyncInput(task.input);
    // 同步任务（deliverToQueue=false）结果走 tool return，永不进队列——不属于补投范围
    if (!input || input.deliverToQueue === false) continue;
    const sessionId = input.sessionId;
    // 会话已删除/归档：autoConsume 必然 skipped，跳过避免每轮空转补投（任务行保持原状）
    let session: { status?: string | null } | null = null;
    try {
      session = await services.session.getByIdLite(sessionId);
    } catch {
      session = null;
    }
    if (!session || session.status === "archived" || session.status === "deleted") {
      result.skippedSessionGone++;
      continue;
    }
    console.warn(`[reconciler] 补投未投递终态 jobId=${task.id} session=${sessionId}（重新走 notify/autoConsume 管道）`);
    await notifyAsyncDelivery(
      sessionId,
      task.id,
      task.status === "failed" ? "failed" : "done",
      input.taskLabel,
      services,
      config,
    );
    result.renotifiedUndelivered++;
  }

  return result;
}

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 挂载投递对账者：启动即跑一轮 + 周期跑（周期复用 stream.cleanupIntervalMs 量级——
 * 与 SessionStreamHub 事件清理同节拍，不新增 config 面）。
 * 重复调用先停旧定时器（幂等）。返回停止函数（优雅退出用）。
 */
export function startAsyncDeliveryReconciler(config: AppConfig, services: ServiceContainer): () => void {
  stopAsyncDeliveryReconciler();
  const intervalMs = Math.max(1000, config.stream.cleanupIntervalMs);
  const runRound = () => {
    void reconcileAsyncDeliveries({ services, config }).catch((err) => {
      console.warn("[reconciler] 对账轮次失败（下轮重试）:", err);
    });
  };
  runRound();
  reconcilerTimer = setInterval(runRound, intervalMs);
  // 不阻止进程退出（测试/脚本场景忘记 stop 也不悬挂）
  reconcilerTimer.unref?.();
  return stopAsyncDeliveryReconciler;
}

export function stopAsyncDeliveryReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}

/* -------------------------------------------------------------------------- */
/* R-2 重启恢复（启动首扫，四动作，全部条件写幂等，DB 为 ground truth） */

export interface StartupRecoveryResult {
  /** 动作 1：僵尸 running/queued async Task 标 failed 数（不可重入 + 已达自动重跑上限） */
  staleTasksFailed: number;
  /** 动作 1：僵尸中 reentrant=true 且未达上限、已重建执行体自动续跑入池数（C-2） */
  staleTasksResumed: number;
  /** 动作 2：僵尸 running ChatSession 标 paused 数 */
  zombieSessionsPaused: number;
  /** B2：超龄软认领 SessionQueueItem 重置 claimedAt 数 */
  staleQueueClaimsReleased: number;
  /** 动作 3：superior 孤儿队列项重注册 drain 的会话数 */
  superiorDrainsRegistered: number;
  /** 动作 4：合并对账首轮（R-2 动作 2 补投 delivered=false + R-1 孤儿回滚补投 delivered=true） */
  reconcile: ReconcileAsyncDeliveriesResult;
}

/**
 * 服务重启恢复首扫（启动序列一次性执行；周期对账由 startAsyncDeliveryReconciler 负责）。
 * 不是第三条并行恢复路径——动作 1 收拢既有 recoverStaleAsyncJobs，动作 2 与 R-1 孤儿共用
 * reconcileAsyncDeliveries 同一幂等入口（CLAIM 原子互斥 + notify/autoConsume 管道）。
 *
 * 四动作（顺序敏感；B4：僵尸会话 paused 先于 Task 续跑，避免刚被 resume 置 running 的子会话被误伤）：
 * 1. 僵尸 running ChatSession → paused（条件写 updateMany）：重启后 hub 无任何活跃流，
 *    仍 running 的会话都是尸体。
 * 2. 僵尸 running/queued async Task 两态分叉（C-2）：reentrant=true 且 retryCount<maxRetries
 *    → retryCount+1 先落库并认领为 resuming，重建执行体入池；否则 → failed。
 * 3. superior 孤儿 SessionQueueItem → 重新注册 drain（含 B2 超龄软认领重置）。
 * 4. 合并对账首轮（reconcileAsyncDeliveries）。
 */
export async function runStartupRecovery(options: {
  config: AppConfig;
  services: ServiceContainer;
}): Promise<StartupRecoveryResult> {
  const { config, services } = options;
  // B4 动作 1：僵尸 running 会话 → paused（先于 Task 续跑，防误伤刚起流的子会话）
  const zombieSessions = await prisma.chatSession.updateMany({
    where: { status: "running" },
    data: { status: "paused" },
  });
  // 动作 2：Task 恢复（reentrant 续跑入池 / 否则 failed）
  const { failed: staleTasksFailed, resumed: staleTasksResumed } = await recoverStaleAsyncJobs(config, services);
  // B2：超龄软认领重置（须在 superior drain 重注册之前）
  const staleQueueClaimsReleased = await services.sessionQueueItem.releaseStaleClaims();
  // 动作 3：superior 孤儿 drain 重注册
  const { requeueOrphanedSuperiorDrains } = await import("./tools/native/swarm.js");
  const superiorDrainsRegistered = await requeueOrphanedSuperiorDrains(config, services);
  // 动作 4 + R-1 孤儿：合并对账首轮
  const reconcile = await reconcileAsyncDeliveries({ services, config });
  return {
    staleTasksFailed,
    staleTasksResumed,
    zombieSessionsPaused: zombieSessions.count,
    staleQueueClaimsReleased,
    superiorDrainsRegistered,
    reconcile,
  };
}

/** 子会话状态变更必须广播到父会话 SSE：父会话任务卡片/列表依赖此外部事件刷新，不依赖前端轮询。 */
export async function notifySubagentSessionUpdate(params: {
  parentSessionId: string;
  subagentSessionId: string;
  status: string;
  title?: string;
  agentId?: string | null;
}): Promise<void> {
  try {
    const { getStreamHub } = await import("./sessionStreamHub.js");
    const hub = getStreamHub();
    if (!hub) return;
    hub.pushExternalEvent(params.parentSessionId, {
      type: "subagent_session_update",
      parentSessionId: params.parentSessionId,
      subagentSessionId: params.subagentSessionId,
      status: params.status,
      title: params.title,
      agentId: params.agentId,
    });
  } catch (err) {
    console.warn(`[asyncJobManager] notifySubagentSessionUpdate 失败:`, err);
  }
}

let _asyncPushWired = false;

/**
 * 将 AsyncJobOrchestrator 生命周期事件桥接到 SessionStreamHub（推优先）。
 * 幂等：进程内只注册一次。
 */
export function wireAsyncJobPush(config: AppConfig): void {
  if (_asyncPushWired) return;
  _asyncPushWired = true;
  const orchestrator = getAsyncJobOrchestrator(config);
  orchestrator.onAny((ev) => {
    void (async () => {
      try {
        const { getStreamHub } = await import("./sessionStreamHub.js");
        const hub = getStreamHub();
        if (!hub) return;
        const statusMap = {
          queued: "queued",
          started: "running",
          completed: "done",
          cancelled: "cancelled",
          failed: "failed",
          timeout: "failed",
        } as const;
        const stats = getAsyncQueueStats(config);
        hub.pushExternalEvent(ev.sessionId, {
          type: "async_job_update",
          sessionId: ev.sessionId,
          jobId: ev.jobId,
          status: statusMap[ev.type],
          stats,
        });
      } catch (err) {
        console.warn(`[asyncJobManager] async_job_update 推送失败:`, err);
      }
    })();
  });
}

/** 单测重置推送接线标志 */
export function resetAsyncJobPushWireForTests(): void {
  _asyncPushWired = false;
}

/**
 * W11：服务启动时将遗留 running 的 Run 标为 interrupted（与 recoverStaleAsyncJobs 同款机制）。
 * 如实声明不假装能续跑——运行中的 ReAct 状态随进程丢失，完整 checkpoint 重建另立设计。
 */
export async function recoverStaleRuns(): Promise<number> {
  const result = await prisma.run.updateMany({
    where: { status: "running" },
    data: { status: "interrupted" },
  });
  return result.count;
}

/**
 * v10 可重入续跑 + C1 执行型僵尸收拢：服务启动扫描 status∈(running,queued) 的执行型 Task。
 *
 * 识别面（不再只认 [async]/async_agent）：
 * - 异步：name `[async]*` / type=async_agent（既有 reentrant 续跑语义不变）
 * - 心跳：name `[heartbeat]*`（默认不可重入 → failed）
 * - cron / oneshot：type 命中（含 TriggerEngine 叠跑遗留的 running 行）
 *
 * 同函数内两态分叉——仅「可解析的 async input + reentrant」走续跑，其余标 failed：
 *
 * - 自动续跑（reentrant=true 且 retryCount < maxRetries）：retryCount+1 **先落库**
 *   （crash-loop 防护即账本——崩在入池前也计数），状态重置 queued（queuedAt 刷新、
 *   startedAt/finishedAt 置空），从 input 重建执行体入 v8 全局池。
 *   恢复风暴不设新限流层：调度/背压全交池（maxGlobal/queuedTimeoutMs）。
 *   入池被拒（maxQueued 满）：retryCount 已 +1，Task 维持 queued 不标 failed——
 *   下次启动恢复只要 retryCount<maxRetries 会再尝试入池（如实状态，不假装已调度）。
 * - 标 failed（R-2 语义）：reentrant=false「服务重启，任务中断」；
 *   reentrant=true 但 retryCount>=maxRetries「已达自动重试上限（N 次），需人工介入」。
 *   子会话同步标 failed 的既有行为保持。
 *
 * 幂等：启动一次+测试可能重复调用——逐条条件写认领（updateMany where id + status in
 * (running,queued) 当前快照），落选（count=0）跳过，重入/并发安全。
 * B4：续跑认领写中间态 `resuming`（认领条件排除之），同进程二次调用不会再 +retryCount / 双入池；
 * 入池成功后由执行体转 running；入池被拒回落 queued 待下次恢复。
 */
export async function recoverStaleAsyncJobs(
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ failed: number; resumed: number }> {
  const stale = await prisma.task.findMany({
    where: {
      status: { in: ["running", "queued"] },
      OR: [
        { name: { startsWith: "[async]" } },
        { type: "async_agent" },
        { name: { startsWith: "[heartbeat]" } },
        { type: "cron" },
        { type: "oneshot" },
      ],
    },
  });
  let failed = 0;
  let resumed = 0;
  for (const task of stale) {
    const input = parseAsyncInput(task.input);

    // 仅可解析的 async 输入才具备续跑重建能力；心跳/cron/trigger 僵尸默认不可重入 → failed
    if (input && task.reentrant && task.retryCount < task.maxRetries) {
      // B4：认领 → resuming（排除二次认领），再入池
      const claimed = await prisma.task.updateMany({
        where: { id: task.id, status: { in: ["running", "queued"] } },
        data: {
          retryCount: { increment: 1 },
          status: "resuming",
          queuedAt: new Date(),
          startedAt: null,
          finishedAt: null,
        },
      });
      if (claimed.count === 0) continue; // 并发落选：已被其他恢复调用处理
      try {
        getAsyncJobOrchestrator(config).enqueue({
          jobId: task.id,
          sessionId: input.sessionId,
          timeoutMs: input.timeoutMs,
          execute: buildAsyncExecute(
            config,
            services,
            task.id,
            input.task,
            input.agentSnapshot,
            "auto",
            input.subagentSessionId,
            input.toolCall ? "tool" : "llm",
            input.toolCall,
            input.shareToSessionIds,
            input.sessionId,
          ),
        });
        resumed++;
      } catch (err) {
        // 入池被拒：回落 queued（非 resuming），不回滚计数——下次恢复可再认领
        await prisma.task
          .updateMany({
            where: { id: task.id, status: "resuming" },
            data: { status: "queued" },
          })
          .catch(() => {});
        console.warn(
          `[recoverStaleAsyncJobs] 僵尸任务 ${task.id} 续跑入池被拒，回落 queued 待下次恢复:`,
          err instanceof Error ? err.message : err,
        );
      }
      continue;
    }

    // R-2 / C1：标 failed（error 文案两态区分），条件写认领保证幂等
    const errorText =
      input && task.reentrant
        ? `已达自动重试上限（${task.maxRetries} 次），需人工介入`
        : "服务重启，任务中断";
    const claimedFailed = await prisma.task.updateMany({
      where: { id: task.id, status: { in: ["running", "queued"] } },
      data: {
        status: "failed",
        finishedAt: new Date(),
        output: { error: errorText },
        // 心跳行避免再被 pullAsyncDeliveries 误扫：与 heartbeatEngine 投递口径对齐
        ...(task.name.startsWith("[heartbeat]")
          ? { delivered: true, deliveredAt: new Date() }
          : {}),
      },
    });
    if (claimedFailed.count === 0) continue; // 并发落选
    // 同步 subagent ChatSession 状态为 failed（避免卡片永久停在 running/queued）
    if (input?.subagentSessionId) {
      try {
        await prisma.chatSession.update({
          where: { id: input.subagentSessionId },
          data: { status: "failed" },
        });
      } catch {
        // subagent session 可能已删除，忽略
      }
    }
    failed++;
  }
  return { failed, resumed };
}

/** 投递后 Task 行默认保留 7 天供 UI 追溯；超期物理删除，已删行不再参与对账与队列展示。 */
export async function cleanupDeliveredAsyncJobs(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const before = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.task.deleteMany({
    where: {
      name: { startsWith: "[async]" },
      delivered: true,
      deliveredAt: { lt: before },
    },
  });
  return count;
}

/** 拉取未投递的异步结果（不 CLAIM）。消费时再 markAsyncDeliveryConsumed。
 *  pinned 的结果也会返回，供前端展示，但 consumeQueue 会跳过。 */
export async function pullAsyncDeliveries(sessionId: string): Promise<AsyncQueueDelivery[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      input: unknown;
      output: unknown;
      status: string;
      createdAt: Date;
      pinned: number;
    }>
  >`
    SELECT id, input, output, status, createdAt, pinned
    FROM "Task"
    WHERE sessionId = ${sessionId}
      AND (name LIKE '[async]%' OR type = 'async_agent')
      AND status IN ('success', 'failed')
      AND delivered = 0
    ORDER BY createdAt ASC
  `;

  const deliveries: AsyncQueueDelivery[] = [];
  for (const row of rows) {
    // v7 两级分组隔离：deliverToQueue=false 同步任务结果走 tool return，永不进异步队列/气泡。
    // 过滤窗口：sync 任务完成落库到 tool return 标 delivered 之间，防止被误拉进队列。
    if (parseAsyncInput(row.input)?.deliverToQueue === false) continue;
    const delivery = toDelivery(row);
    if (delivery) deliveries.push(delivery);
  }
  return deliveries;
}

/** 拉取已消费的异步结果（供右侧「已消费」标签追溯，默认最近 30 条） */
export async function pullConsumedAsyncDeliveries(
  sessionId: string,
  limit = 30,
): Promise<AsyncQueueDelivery[]> {
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      delivered: true,
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
      status: { in: ["success", "failed"] },
    },
    orderBy: { deliveredAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
  });
  const deliveries: AsyncQueueDelivery[] = [];
  for (const row of rows) {
    // v7 两级分组隔离：deliverToQueue=false 同步任务在 tool return 时标 delivered=true，但不属于异步队列的「已消费」，跳过。
    if (parseAsyncInput(row.input)?.deliverToQueue === false) continue;
    const delivery = toDelivery(row);
    if (delivery) deliveries.push(delivery);
  }
  return deliveries;
}

/** v9 原子 CLAIM：消费时把 Task.delivered 与 AgentMessage 账本同事务标为已投递。与 autoConsume 竞态，先到者执行；pinned 不可 CLAIM。 */
export async function markAsyncDeliveryConsumed(jobId: string): Promise<boolean> {
  // W14：前端认领路径与服务端 autoConsume 是同一条 Task 管道的两个竞态认领方，
  // delivered 记账必须同样落在 CLAIM 事务里，否则前端抢到 claim 时旁路邮箱又会残留 pending。
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.task.updateMany({
      where: { id: jobId, delivered: false, pinned: false },
      data: { delivered: true, deliveredAt: new Date() },
    });
    if (r.count > 0) {
      await markAgentMessageDeliveredByTaskRef(tx, jobId);
    }
    return r;
  });
  return result.count > 0;
}

/** 列出会话运行中的异步任务（v7 两级分组：deliverToQueue=false 同步任务不进入 running 列表，避免双分组重复展示）。 */
export async function listRunningAsyncJobs(sessionId: string): Promise<AsyncRunningJob[]> {
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      status: "running",
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
    orderBy: { createdAt: "desc" },
  });
  return rows
    .map((row): AsyncRunningJob | null => {
      const input = parseAsyncInput(row.input);
      if (!input) return null;
      // v7 两级分组隔离：deliverToQueue=false 同步任务专属「同步任务」区，
      // 不进异步 running 列表，防止 running 期间双分组重复展示。
      if (input.deliverToQueue === false) return null;
      const output = parseAsyncOutput(row.output);
      const base: AsyncRunningJob = {
        jobId: row.id,
        sessionId,
        taskLabel: input.taskLabel,
        status: "running",
        logs: output.logs,
        createdAt: row.createdAt.getTime(),
        sourceType: input.sourceType,
      };
      if (input.subagentSessionId) base.subagentSessionId = input.subagentSessionId;
      return base;
    })
    .filter((j): j is AsyncRunningJob => j !== null);
}

export interface AsyncQueuedJob {
  jobId: string;
  sessionId: string;
  taskLabel: string;
  status: "queued";
  position?: number;
  /** 排队原因：首个卡住的上限（orchestrator 真实判定，TP-2）；不在池内存队列时为 undefined（如重启后 DB 残留 queued） */
  reason?: AsyncJobQueuedReason;
  /** W3：reason=gate 时的阻塞详情（因审批 X 阻塞 scope） */
  gateBlock?: { approvalId: string; scope: string; reason: string };
  subagentSessionId?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  sourceType?: AsyncTaskSourceType;
}

export async function listQueuedAsyncJobs(
  sessionId: string,
  config: AppConfig,
): Promise<AsyncQueuedJob[]> {
  const orchestrator = getAsyncJobOrchestrator(config);
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      status: "queued",
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .map((row): AsyncQueuedJob | null => {
      const input = parseAsyncInput(row.input);
      if (!input) return null;
      // v7 两级分组隔离：deliverToQueue=false 同步任务专属「同步任务」区，不进异步 queued 列表。
      if (input.deliverToQueue === false) return null;
      const output = parseAsyncOutput(row.output);
      const reason = orchestrator.getQueuedReason(row.id);
      const base: AsyncQueuedJob = {
        jobId: row.id,
        sessionId,
        taskLabel: input.taskLabel,
        status: "queued",
        position: orchestrator.getPosition(row.id),
        reason,
        gateBlock: reason === "gate" ? orchestrator.getGateBlock(row.id) : undefined,
        logs: output.logs,
        createdAt: row.createdAt.getTime(),
        sourceType: input.sourceType,
      };
      if (input.subagentSessionId) base.subagentSessionId = input.subagentSessionId;
      return base;
    })
    .filter((j): j is AsyncQueuedJob => j !== null);
}

export interface SyncAsyncJob {
  jobId: string;
  taskLabel: string;
  status: "queued" | "running" | "completed" | "failed";
  elapsedMs?: number;
  asyncResult?: string;
  error?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  finishedAt?: number;
  subagentSessionId?: string;
  sourceType?: AsyncTaskSourceType;
}

/**
 * 列出会话的同步任务（waitForResult=true → deliverToQueue=false），供右栏「同步任务」区展示。
 * 同步任务结果走 tool return 返回父流，不进异步队列、不进气泡、不可 pin/consume。
 * status 判定与 getAsyncJobStatus 同源：orchestrator isRunning/isQueued 优先，DB 状态兜底。
 */
export async function listSyncAsyncJobs(
  sessionId: string,
  config: AppConfig,
  limit = 30,
): Promise<SyncAsyncJob[]> {
  const take = Math.max(1, Math.min(limit, 100));
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
    orderBy: { createdAt: "desc" },
    take: take * 2,
  });
  const orchestrator = getAsyncJobOrchestrator(config);
  const items: SyncAsyncJob[] = [];
  for (const row of rows) {
    const input = parseAsyncInput(row.input);
    if (!input || input.deliverToQueue !== false) continue;
    const output = parseAsyncOutput(row.output);
    const running = orchestrator.isRunning(row.id);
    const queued = orchestrator.isQueued(row.id);
    const createdAtMs =
      row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
    const status: SyncAsyncJob["status"] = running
      ? "running"
      : queued
        ? "queued"
        : row.status === "success"
          ? "completed"
          : row.status === "failed"
            ? "failed"
            : row.status === "running" || row.status === "queued"
              ? row.status
              : "failed";
    items.push({
      jobId: row.id,
      taskLabel: input.taskLabel,
      status,
      elapsedMs: running || row.status === "running" ? Date.now() - createdAtMs : undefined,
      asyncResult: output.asyncResult,
      error: output.error,
      logs: output.logs,
      createdAt: createdAtMs,
      finishedAt: row.finishedAt
        ? row.finishedAt instanceof Date
          ? row.finishedAt.getTime()
          : new Date(row.finishedAt).getTime()
        : undefined,
      subagentSessionId: input.subagentSessionId,
      sourceType: input.sourceType,
    });
    if (items.length >= take) break;
  }
  return items;
}

/** 取消必须幂等：运行中 abort 信号；排队中移出队列且手动回写 failed。只清队列不会触发 execute finally，不能漏状态回写。 */
export async function cancelAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ cancelled: boolean; message: string }> {
  const task = await services.task.getById(jobId);
  if (!task) return { cancelled: false, message: "任务不存在" };
  // 接受 running 与 queued 两种活跃状态；已完成（success/failed）的不允许取消
  if (task.status !== "running" && task.status !== "queued") {
    return { cancelled: false, message: "任务未在运行中或排队中" };
  }

  const orchestrator = getAsyncJobOrchestrator(config);
  const cancelled = orchestrator.cancel(jobId);
  if (!cancelled) {
    // 任务可能刚好执行完但尚未被 poll，把仍标记为 running/queued 的记录置为失败，防止永久占坑
    await services.task.update({
      id: jobId,
      status: "failed",
      finishedAt: new Date(),
      output: { error: "任务已结束或丢失，取消失败" } satisfies AsyncTaskOutput,
    } as any);
    return { cancelled: true, message: "任务已结束，已标记为失败" };
  }

  // 对排队中任务，orchestrator 只清队列不会执行 finally，需要手动回写状态
  await services.task.update({
    id: jobId,
    status: "failed",
    finishedAt: new Date(),
    output: { error: "异步任务已取消" } satisfies AsyncTaskOutput,
  } as any);
  return { cancelled: true, message: "已取消异步任务" };
}

function buildAsyncExecute(
  config: AppConfig,
  services: ServiceContainer,
  jobId: string,
  task: string,
  agentSnapshot: AsyncTaskInput["agentSnapshot"],
  // 重跑来源（仅系统提示文案；自动重跑计数唯一事实源 = Task.retryCount 列）：
  // null=首发；"manual"=手动 retryAsyncJob；"auto"=重启恢复自动续跑
  retryKind: "manual" | "auto" | null,
  subagentSessionId?: string,
  mode: "llm" | "tool" = "llm",
  toolCall?: { tool: string; args: Record<string, unknown> },
  shareToSessionIds?: string[],
  parentSessionId?: string,
): (signal: AbortSignal) => Promise<void> {
  const invokeTrpc = createTrpcInvoker({ services });
  const retryHint = retryKind === "manual" ? "（手动重试）" : retryKind === "auto" ? "（服务重启自动续跑）" : "";
  const syncSubStatus = async (status: "completed" | "failed" | "paused" | "running") => {
    if (!subagentSessionId) return;
    try {
      await services.session.update({ id: subagentSessionId, status });
      if (parentSessionId) {
        await notifySubagentSessionUpdate({
          parentSessionId,
          subagentSessionId,
          status,
        });
      }
    } catch (err) {
      console.warn(`[asyncJobManager] syncSubStatus(${status}) 失败 for ${subagentSessionId}:`, err);
    }
  };
  const broadcastShare = async (status: "success" | "failed", output: AsyncTaskOutput) => {
    if (!shareToSessionIds?.length) return;
    const input = parseAsyncInput((await services.task.getById(jobId))?.input);
    if (!input) return;
    for (const targetSessionId of shareToSessionIds) {
      if (targetSessionId === input.sessionId) continue;
      try {
        await services.task.create({
          name: `[async-share] ${input.taskLabel}`,
          type: "oneshot",
          status,
          sessionId: targetSessionId,
          input: { ...input, sessionId: targetSessionId, shareToSessionIds: undefined },
        } as any);
      } catch (err) {
        console.warn(`[asyncJobManager] broadcastShare 到 ${targetSessionId} 失败:`, err);
      }
    }
  };
  const subagentOnly = agentSnapshot.tier === "sub";
  const workerTools = subagentOnly ? getAllowedToolsForTier("sub", agentSnapshot.tools) : agentSnapshot.tools;

  const subagentHint = subagentOnly
    ? "\n\n注意：你是被派来直接执行该任务的子 Agent。你可以调用 async_task_run（toolCall 指定要执行的工具）把耗时步骤放入后台执行，但禁止调用 spawn_subagent、agent_create*、agent_send_message、agent_report_back 等再次派生或管理 Agent 的工具。请直接使用其他可用工具完成任务，不要继续追问用户。"
    : "";
  const agentSystemPrompt = `${agentSnapshot.systemPrompt}\n\n你正在执行后台异步任务${retryHint}。完成后用简洁中文汇总结果，不要继续追问用户。${subagentHint}`;
  const agentForLoop = { model: agentSnapshot.model, systemPrompt: agentSystemPrompt, tools: workerTools };
  const runLoopOptions = {
    config,
    services,
    agent: agentForLoop,
    messages: [{ role: "user", content: task } as const],
    invokeTrpc,
    sessionId: subagentSessionId,
    agentMeta: agentSnapshot,
    runOrigin: "parent" as const,
  };

  const finalizeSuccess = async (
    loop: {
      content: string;
      toolCalls: StoredToolCall[];
      tokenUsage: { prompt: number; completion: number; total: number };
      model: string;
      provider: string;
      roundsUsed: number;
    },
    emit?: (event: AgentStreamEvent) => void,
  ) => {
    const resultText = loop.content || "(无文本输出)";
    const tokenUsage = loop.tokenUsage;
    await appendAsyncJobLog(jobId, { level: "info", message: `任务完成，共 ${loop.roundsUsed} 轮` }, services);
    // 为什么结果要落一条 assistant 消息：子会话消息链是 ReAct 上下文的事实源
    //（agentRuntime/agentStream 均按 sessionId 从消息表扁平重建多轮上下文），只写 Task.output 会断链；同时供子会话页可视化。
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "assistant",
          content: resultText,
          toolCalls: loop.toolCalls as any,
          tokenUsage: tokenUsage ?? undefined,
          source: "sub",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子 Agent 结果消息失败:`, msgErr);
      }
    }
    const existingOutput = parseAsyncOutput((await services.task.getById(jobId))?.output);
    await services.task.update({
      id: jobId,
      status: "success",
      finishedAt: new Date(),
      output: {
        asyncResult: resultText,
        tokenUsage,
        logs: existingOutput.logs,
      } satisfies AsyncTaskOutput,
    } as any);
    await syncSubStatus("completed");
    if (agentSnapshot.tier === "sub" && agentSnapshot.parentId) {
      await services.agent.update({ id: agentSnapshot.id, status: "dormant" } as any).catch((err) => {
        console.warn(`[asyncJobManager] 标记子 Agent dormant 失败 agent=${agentSnapshot.id}:`, err instanceof Error ? err.message : err);
      });
    }
    await broadcastShare("success", { asyncResult: resultText, tokenUsage });
    const parentInput = parseAsyncInput((await services.task.getById(jobId))?.input);
    // v7 唯一投递闸：deliverToQueue=false（同步等待）时结果唯一通道是 tool return，禁止 notify 进队列二次投喂
    if (parentInput?.sessionId && parentInput.deliverToQueue !== false) {
      await notifyAsyncDelivery(parentInput.sessionId, jobId, "done", parentInput.taskLabel, services, config);
    }
    emit?.({
      type: "done",
      sessionId: subagentSessionId!,
      agentId: agentSnapshot.id,
      content: resultText,
      toolCalls: loop.toolCalls,
      model: loop.model,
      provider: loop.provider,
      roundsUsed: loop.roundsUsed,
      tokenUsage,
    });
  };

  const finalizeFailure = async (err: unknown, emit?: (event: AgentStreamEvent) => void) => {
    const isAbort = isAbortLikeError(err);
    const isTimeout = err instanceof Error && err.message.includes("超时");
    const errorText = isAbort
      ? messageFromAbortSignal(undefined, err)
      : isTimeout
        ? "异步任务执行超时"
        : err instanceof Error
          ? err.message
          : String(err);
    await appendAsyncJobLog(jobId, { level: "error", message: errorText }, services);
    const existingOutputFailed = parseAsyncOutput((await services.task.getById(jobId))?.output);
    await services.task.update({
      id: jobId,
      status: "failed",
      finishedAt: new Date(),
      output: {
        error: errorText,
        logs: existingOutputFailed.logs,
      } satisfies AsyncTaskOutput,
    } as any);
    await syncSubStatus(isAbort && !isTimeout ? "paused" : "failed");
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "assistant",
          content: `任务未能完成：${errorText}`,
          source: "sub",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子 Agent 失败消息失败:`, msgErr);
      }
    }
    await broadcastShare("failed", { error: errorText });
    const parentInputFailed = parseAsyncInput((await services.task.getById(jobId))?.input);
    // sync 失败走 tool return；sleep/纯工具失败不进对话气泡（右栏 Task 仍可见）
    const skipFailedBubble =
      parentInputFailed?.sourceType === "sleep" || parentInputFailed?.sourceType === "async_task_tool";
    if (
      parentInputFailed?.sessionId &&
      parentInputFailed.deliverToQueue !== false &&
      !skipFailedBubble
    ) {
      await notifyAsyncDelivery(parentInputFailed.sessionId, jobId, "failed", parentInputFailed.taskLabel, services, config);
    }
    emit?.({ type: "error", message: errorText, sessionId: subagentSessionId });
  };

  const runToolOnly = async (signal: AbortSignal) => {
    if (!toolCall) throw new Error("mode=tool 但未提供 toolCall");
    const parsed = parseAgentTools(workerTools);
    const registry = new Map<string, ToolRegistryEntry>();
    await buildAgentToolSchemas(services, parsed, registry);
    const toolCtx = createAgentToolContext(config, services, invokeTrpc, parsed, undefined, {
      // 纯工具异步复用父会话上下文；缺 sessionId 会导致 sleep(async=true) 等工具直接抛错
      sessionId: subagentSessionId ?? parentSessionId,
      agentSnapshot,
      runOrigin: "parent",
    });
    const call: LlmToolCall = {
      id: `tool-${jobId.slice(0, 8)}`,
      type: "function",
      function: { name: toolCall.tool, arguments: JSON.stringify(toolCall.args ?? {}) },
    };
    const results = await executeToolCallsBatch([call], toolCtx, registry, parsed, signal);
    const result = results[0]?.result;
    const resultText = typeof result === "string" ? result : JSON.stringify(result ?? null);
    if (subagentSessionId) {
      await services.message.create({
        sessionId: subagentSessionId,
        role: "assistant",
        content: resultText,
        source: "sub",
      }).catch(() => {});
    }
    await services.task.update({
      id: jobId,
      status: "success",
      finishedAt: new Date(),
      output: { asyncResult: resultText } satisfies AsyncTaskOutput,
    } as any);
    await syncSubStatus("completed");
    await broadcastShare("success", { asyncResult: resultText });
    const parentInputTool = parseAsyncInput((await services.task.getById(jobId))?.input);
    // 同 finalizeSuccess 的 v7 投递闸（纯工具路径）
    if (parentInputTool?.sessionId && parentInputTool.deliverToQueue !== false) {
      await notifyAsyncDelivery(parentInputTool.sessionId, jobId, "done", parentInputTool.taskLabel, services, config);
    }
  };

  return async (signal) => {
    // 任务原文落 user 消息：与 finalizeSuccess 的 assistant 结果消息配对，构成子会话 ReAct 上下文事实链（同上）
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "user",
          content: task,
          source: "super",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子 Agent 任务消息失败:`, msgErr);
      }
    }

    try {
      if (signal.aborted) {
        throw new Error("异步任务已被取消");
      }
      await syncSubStatus("running");
      try {
        await services.task.update({ id: jobId, status: "running", startedAt: new Date() } as any);
      } catch (err) {
        console.warn(`[asyncJobManager] 标记任务 running 失败 job=${jobId}:`, err instanceof Error ? err.message : err);
      }
      await appendAsyncJobLog(jobId, { level: "info", message: "任务开始执行" }, services);

      if (mode === "tool") {
        await runToolOnly(signal);
        return;
      }

      if (subagentSessionId) {
        const hub = getStreamHub();
        if (hub) {
          // Q2 不双算：池内任务起流的子会话在起流前 claim 占用（池槽位已计 runningGlobal，
          // 不 claim 则同一执行体被 hub 交互 running 再计一次）。claim → startIfNotRunning 之间
          // 无 await 交错点；release 在 waitFor 解析之后（completed=true 已不计交互 running），无窗口。
          // 本闭包是所有 isSubagent 池任务（session.spawn / rerun / retry）唯一执行体工厂，
          // 不变量收在此处，不靠各入口自觉。
          const releaseClaim = getAsyncJobOrchestrator(config).claimOccupancy(subagentSessionId);
          try {
            const hubInput = {
              sessionId: subagentSessionId,
              agentId: agentSnapshot.id,
              message: task,
            };
            const started = await hub.startIfNotRunning(subagentSessionId, hubInput, async (emit, hubSignal) => {
              try {
                const loop = await runAgentLoopStream({
                  ...runLoopOptions,
                  llmOptions: {},
                  emit,
                  signal: hubSignal,
                });
                await finalizeSuccess(loop, emit);
              } catch (runErr) {
                await finalizeFailure(runErr, emit);
              }
            });
            if (started === "started") {
              // 池 abort（超时/取消）必须传导到 hub 真正停子会话流，否则 LLM 在后台继续空转烧钱
              signal.addEventListener("abort", () => hub.stop(subagentSessionId), { once: true });
              // 通知前端挂接子会话流（切到子页时不必等刷新）
              hub.pushExternalEvent(subagentSessionId, {
                type: "session_run_started",
                sessionId: subagentSessionId,
                reason: "subagent_start",
                jobId,
              });
              if (parentSessionId) {
                hub.pushExternalEvent(parentSessionId, {
                  type: "session_run_started",
                  sessionId: subagentSessionId,
                  reason: "subagent_start",
                  jobId,
                });
              }
            }
            await hub.waitFor(subagentSessionId);
            return;
          } finally {
            releaseClaim();
          }
        }
      }

      const loop = await runAgentLoop({
        ...runLoopOptions,
        signal,
        onProgress: (message) => appendAsyncJobLog(jobId, { level: "progress", message }, services),
      });
      await finalizeSuccess(loop);
    } catch (err: unknown) {
      await finalizeFailure(err);
    }
  };
}

export async function startAsyncAgentTask(options: {
  sessionId: string;
  task: string;
  label?: string;
  timeoutMs?: number;
  config: AppConfig;
  services: ServiceContainer;
  agent: { id: string; model: string; systemPrompt: string; tools: string[] };
  /** 调用来源，用于 Agent.source 与审计区分 async_task_run / spawn_subagent */
  source?: string;
  /** 是否属于 spawn_subagent 派生的子 Agent（UI 显示“与之对话”） */
  isSubagent?: boolean;
  /** 异步任务模式：llm=后台 LLM 推理；tool=纯工具执行（不调用 LLM） */
  mode?: "llm" | "tool";
  /** mode=tool 时直接指定要执行的一次性工具调用 */
  toolCall?: { tool: string; args: Record<string, unknown> };
  /** swarm 协作：结果额外广播到这些会话 */
  shareToSessionIds?: string[];
  /**
   * v7 通道收敛锚点：true = 结果进异步队列，经原子 CLAIM 后注入会话；
   * false = 结果走 tool return 直返父 Agent（如 waitForResult=true）。两条通道互斥，禁止同时开闸。
   * 默认 true。
   */
  deliverToQueue?: boolean;
}): Promise<{ jobId: string; status: "queued" | "running"; message: string; subagentSessionId?: string }> {
  const task = options.task.trim();
  if (!task) throw new Error("task 不能为空");
  if (!options.sessionId) throw new Error("async_task_run 需要有效 sessionId");

  const mode = options.mode ?? "llm";
  const isSubagent = options.isSubagent === true;

  if (mode === "tool" && options.toolCall && !options.toolCall.tool) {
    throw new Error("mode=tool 时必须提供有效的 toolCall.tool");
  }

  // 预算检查：只有 LLM 模式才需要检查 LLM 预算
  if (mode === "llm") {
    assertLlmBudget(options.config);
  }

  const taskLabel = options.label?.trim() || task.slice(0, 80);

  let sourceType: AsyncTaskSourceType;
  if (isSubagent) sourceType = "subagent";
  else if (mode === "tool") sourceType = "async_task_tool";
  else sourceType = "async_task_llm";

  const orchestrator = getAsyncJobOrchestrator(options.config);
  const stats = orchestrator.getStats();
  // 纯工具不占 LLM 全局槽，不会因 maxConcurrent 排队；LLM/子 Agent 仍走 Q2 准入口径
  const willQueue =
    mode === "tool"
      ? false
      : stats.runningGlobal + stats.hubInteractiveRunning >= stats.limits.maxGlobal;
  const initialStatus = willQueue ? "queued" : "running";

  const parentAgent = await prisma.agent.findUnique({ where: { id: options.agent.id } }).catch(() => null);
  // 行级 Workspace 槽配额（Q4）；Root 常用 0=不限，业务空间默认 2
  let workspaceSlotQuota: number | undefined;
  const parentWorkspaceId = parentAgent?.workspaceId ?? null;
  if (parentWorkspaceId) {
    const ws = await prisma.workspace.findUnique({ where: { id: parentWorkspaceId } }).catch(() => null);
    const quota = (ws as { asyncSlotQuota?: number } | null)?.asyncSlotQuota;
    if (typeof quota === "number") workspaceSlotQuota = quota;
  }

  // async_task_run：不创建新的 Agent/会话，直接复用父 Agent 身份跑后台任务。
  // spawn_subagent：才创建独立的 tier=sub 子 Agent 和 subagent ChatSession。
  let subAgentId: string | undefined;
  let subagentSessionId: string | undefined;
  let agentSnapshot: AsyncTaskInput["agentSnapshot"];

  if (isSubagent) {
    // 数量上限：防止同一父会话失控开太多 subagent
    const activeCount = await prisma.chatSession.count({
      where: {
        parentSessionId: options.sessionId,
        kind: "subagent",
        status: { in: ["running", "queued"] },
      },
    });
    const limit = options.config.asyncJobs.maxSubagentsPerSession;
    if (activeCount >= limit) {
      throw new Error(`已达到每会话子 Agent 上限（${limit}），请先停止或等待已有任务完成后再启动新任务。`);
    }

    // 子 Agent 只保留执行类工具，禁止继承 spawn/async_task_run/async_task_cancel 等编排工具
    const subagentTools = getAllowedToolsForTier("sub", options.agent.tools);

    try {
      const subAgentResult = await options.services.agent.create({
        name: `${taskLabel.slice(0, 40)} 子 Agent`,
        description: `由 ${parentAgent?.name ?? options.agent.id} 派生的子 Agent（任务：${taskLabel.slice(0, 60)}）`,
        source: options.source ?? "native_tool:spawn_subagent",
        model: options.agent.model,
        systemPrompt: options.agent.systemPrompt,
        tools: subagentTools,
        tier: "sub",
        parentId: options.agent.id,
        workspaceId: parentAgent?.workspaceId ?? undefined,
      });
      if (subAgentResult.success && subAgentResult.data) {
        subAgentId = (subAgentResult.data as { id: string }).id;
      }
    } catch (err) {
      console.warn(`[asyncJobManager] 创建独立子 Agent 失败，降级复用父 Agent:`, err);
    }

    const actualSubAgentId = subAgentId ?? options.agent.id;
    const subagentName = `${taskLabel.slice(0, 40)} 子 Agent`;

    try {
      const sub = await options.services.session.create({
        title: taskLabel.slice(0, 60),
        model: options.agent.model,
        systemPrompt: options.agent.systemPrompt,
        agentId: actualSubAgentId,
        parentSessionId: options.sessionId,
        kind: "subagent",
        taskDescription: task,
        status: initialStatus,
      } as any);
      if (sub.success && sub.data) subagentSessionId = (sub.data as { id: string }).id;
      if (subagentSessionId) {
        void notifySubagentSessionUpdate({
          parentSessionId: options.sessionId,
          subagentSessionId,
          status: initialStatus,
          title: taskLabel.slice(0, 60),
          agentId: actualSubAgentId,
        });
      }
    } catch (err) {
      console.warn(`[asyncJobManager] 创建 subagent session 失败，降级为无可视化载体继续执行:`, err);
    }

    agentSnapshot = {
      id: actualSubAgentId,
      model: options.agent.model,
      systemPrompt: options.agent.systemPrompt,
      tools: options.agent.tools,
      tier: "sub",
      parentId: options.agent.id,
      workspaceId: parentAgent?.workspaceId ?? null,
      name: subagentName,
    };
  } else {
    agentSnapshot = {
      id: options.agent.id,
      model: options.agent.model,
      systemPrompt: options.agent.systemPrompt,
      tools: options.agent.tools,
      tier: parentAgent?.tier ?? "sub",
      parentId: parentAgent?.parentId ?? null,
      workspaceId: parentAgent?.workspaceId ?? null,
      name: parentAgent?.name ?? options.agent.id,
    };
  }

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "async_agent",
    status: willQueue ? "queued" : "running",
    sessionId: options.sessionId,
    queuedAt: willQueue ? new Date() : null,
    startedAt: willQueue ? null : new Date(),
    input: {
      kind: ASYNC_KIND,
      sessionId: options.sessionId,
      task,
      taskLabel,
      agentSnapshot,
      timeoutMs: options.timeoutMs,
      subagentSessionId,
      sourceType,
      toolCall: mode === "tool" ? options.toolCall : undefined,
      shareToSessionIds: options.shareToSessionIds?.length ? options.shareToSessionIds : undefined,
      deliverToQueue: options.deliverToQueue !== false,
    } satisfies AsyncTaskInput,
    // 可重入三列入队物化（单一事实源 = Task 列）：retryCount 从零起步；
    // maxRetries 取 config 快照；reentrant 按工具注册表声明推断
    retryCount: 0,
    maxRetries: options.config.asyncJobs.maxRetries,
    reentrant: inferTaskReentrant({ mode, toolCall: options.toolCall, agentTools: agentSnapshot.tools }),
  } as any);

  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建异步任务失败");
  }

  const jobId = (created.data as { id: string }).id;

  // W10：统一走 SwarmOrchestrator 中介者（并发池/结果聚合/Log 审计公共骨架）；
  // 执行体仍是 buildAsyncExecute（轮询/推送/落库/子会话状态同步语义不动）。
  const swarm = getSwarmOrchestrator(options.config, options.services);
  try {
    await swarm.dispatch({
      origin: isSubagent ? "spawn_subagent" : "async_task_run",
      schedule: "pool",
      sessionId: options.sessionId,
      workspaceId: agentSnapshot.workspaceId ?? parentWorkspaceId ?? null,
      workspaceSlotQuota: mode === "tool" ? undefined : workspaceSlotQuota,
      jobId,
      taskLabel,
      timeoutMs: options.timeoutMs,
      // sleep/纯工具：lightweight 不占全局 LLM 槽
      slotClass: mode === "tool" ? "lightweight" : "llm",
      metadata: subagentSessionId ? { subagentSessionId } : undefined,
      // W3：按工具集声明 requiredScopes，与 pending approval scope 相交则 gate 排队
      tools: Array.isArray(agentSnapshot.tools) ? agentSnapshot.tools : [],
      execute: async (signal) => {
        await buildAsyncExecute(
          options.config,
          options.services,
          jobId,
          task,
          agentSnapshot,
          null,
          subagentSessionId,
          mode,
          options.toolCall,
          options.shareToSessionIds,
          options.sessionId,
        )(signal);
        // 结果聚合：buildAsyncExecute 内部已落库/投递，读回终态供中介者审计
        try {
          const row = await options.services.task.getById(jobId);
          return row?.status === "failed"
            ? { status: "failed" as const, error: parseAsyncOutput(row?.output).error }
            : { status: "success" as const };
        } catch {
          // 任务行已被清理（测试/手动删除）：不阻塞聚合收口
          return { status: "success" as const };
        }
      },
    });
  } catch (err) {
    // 入池拒绝（maxQueued 满）：回收 Task 行，错误上抛（LLM 工具返回「队列已满，请稍后再派」）
    await options.services.task
      .update({
        id: jobId,
        status: "failed",
        finishedAt: new Date(),
        output: { error: err instanceof Error ? err.message : String(err) } satisfies AsyncTaskOutput,
      } as any)
      .catch(() => undefined);
    throw err;
  }

  return {
    jobId,
    status: willQueue ? "queued" : "running",
    subagentSessionId,
    message: (() => {
      const typeLabel = isSubagent ? "子 Agent" : mode === "tool" ? "纯工具异步" : "后台 LLM";
      return willQueue
        ? `已排队${typeLabel}任务「${taskLabel}」（并发槽位已满）。`
        : `已启动${typeLabel}任务「${taskLabel}」。${isSubagent ? "可进入任务会话查看进度。" : "你可以继续对话；完成后结果会进入发送队列最前。"}`;
    })(),
  };
}

/** 轻量异步睡眠：不跑 LLM；到时间后结果强制走 notifyAsyncDelivery 唯一投递闸（v7 通道收敛）。 */
export async function startAsyncSleepTask(options: {
  sessionId: string;
  seconds: number;
  config: AppConfig;
  services: ServiceContainer;
  agentSnapshot: AsyncTaskInput["agentSnapshot"];
}): Promise<{ jobId: string; status: "queued" | "running"; message: string }> {
  const seconds = Math.max(0, Math.min(options.seconds, 300));
  const ms = seconds * 1000;
  const taskLabel = `sleep ${seconds}s`;
  const input: AsyncTaskInput = {
    kind: ASYNC_KIND,
    sessionId: options.sessionId,
    task: `等待 ${seconds} 秒后返回`,
    taskLabel,
    agentSnapshot: options.agentSnapshot,
    sourceType: "sleep",
  };

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "async_agent",
    status: "queued",
    sessionId: options.sessionId,
    queuedAt: new Date(),
    input,
  } as any);
  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建异步定时器任务失败");
  }
  const jobId = (created.data as { id: string }).id;
  const orchestrator = getAsyncJobOrchestrator(options.config);
  try {
    orchestrator.enqueue({
      jobId,
      sessionId: options.sessionId,
      timeoutMs: ms + 10_000,
      // sleep 不占全局 LLM 槽：避免「等 10 秒」堵住 spawn_subagent / 后台推理
      slotClass: "lightweight",
      execute: async (signal) => {
        try {
          await options.services.task.update({ id: jobId, status: "running", startedAt: new Date() } as any);
        } catch {
          /* 状态回写失败不阻塞 */
        }
        const { aborted } = await waitMs(ms, signal);
        if (aborted || signal.aborted) {
          const abortMsg = messageFromAbortSignal(signal);
          await options.services.task.update({
            id: jobId,
            status: "failed",
            finishedAt: new Date(),
            output: {
              error: abortMsg.includes("用户中断") ? "定时器已取消" : abortMsg,
            } satisfies AsyncTaskOutput,
          } as any).catch(() => undefined);
          // 失败不 notify：右栏可见，对话区不灌错误气泡
          return;
        }
        await options.services.task.update({
          id: jobId,
          status: "success",
          finishedAt: new Date(),
          output: { asyncResult: `定时时间${seconds}s到了，请继续完成任务` } satisfies AsyncTaskOutput,
        } as any);
        await notifyAsyncDelivery(options.sessionId, jobId, "done", taskLabel, options.services, options.config);
      },
    });
  } catch (err) {
    // 入池拒绝（maxQueued 满）：回收 Task 行，错误上抛
    await options.services.task
      .update({
        id: jobId,
        status: "failed",
        finishedAt: new Date(),
        output: { error: err instanceof Error ? err.message : String(err) } satisfies AsyncTaskOutput,
      } as any)
      .catch(() => undefined);
    throw err;
  }
  return {
    jobId,
    status: "running",
    message: `定时器已启动，${seconds} 秒后结果会进入发送队列最前（不占用 LLM 并发槽）。`,
  };
}

/** 向运行中/排队中的异步任务追加一条日志。任务执行过程中工具/Agent 可调用此函数写入进度。 */
export async function appendAsyncJobLog(
  jobId: string,
  entry: Omit<AsyncTaskLogEntry, "timestamp">,
  services: ServiceContainer,
): Promise<void> {
  let task: Awaited<ReturnType<ServiceContainer["task"]["getById"]>> | null = null;
  try {
    task = await services.task.getById(jobId);
  } catch {
    // 任务行已删除（测试清理/手动删除）：进度日志是尽力而为，不得向上抛
    // （getById 对缺失行抛 NOT_FOUND；reactLoop 的 onProgress 不 await，抛了就是 unhandled rejection）
    return;
  }
  if (!task) return;
  const output = parseAsyncOutput(task.output);
  const logs: AsyncTaskLogEntry[] = output.logs ?? [];
  logs.push({ ...entry, timestamp: Date.now() });
  // 保留最近 50 条，避免 output JSON 过大
  const trimmed = logs.length > 50 ? logs.slice(logs.length - 50) : logs;
  await services.task.update({
    id: jobId,
    output: { ...output, logs: trimmed },
  } as any).catch(() => undefined);
}

/** 查询单个异步任务状态（W-B：只回状态，不回结果全文/日志——结果完成后经队列唯一通道投递） */
export async function getAsyncJobStatus(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{
  jobId: string;
  status: string;
  taskLabel?: string;
  elapsedMs?: number;
  subagentSessionId?: string;
  timeoutMs?: number;
}> {
  const task = await services.task.getById(jobId);
  if (!task) return { jobId, status: "not_found" };
  const input = parseAsyncInput(task.input);
  const orchestrator = getAsyncJobOrchestrator(config);
  const running = orchestrator.isRunning(jobId);
  const queued = orchestrator.isQueued(jobId);
  const status = running ? "running" : queued ? "queued" : task.status === "success" ? "completed" : task.status === "failed" ? "failed" : task.status;
  return {
    jobId,
    status,
    taskLabel: input?.taskLabel,
    elapsedMs: running || task.status === "running" ? Date.now() - (task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime()) : undefined,
    subagentSessionId: input?.subagentSessionId,
    timeoutMs: input?.timeoutMs ?? config.asyncJobs.taskTimeoutMs,
  };
}

/** 列出某会话的全部异步任务状态（W-B：只回状态，不含日志/结果） */
export async function listSessionAsyncJobs(
  sessionId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<Array<{ jobId: string; status: string; taskLabel?: string; elapsedMs?: number; subagentSessionId?: string }>> {
  // R7：DB 层按 sessionId 过滤，避免全局 task.list(50) 后 JS 过滤漏掉非 top-50 的任务
  const rows = await services.task.list({ page: 1, pageSize: 50, sessionId } as any);
  const orchestrator = getAsyncJobOrchestrator(config);
  const items: Array<{ jobId: string; status: string; taskLabel?: string; elapsedMs?: number; subagentSessionId?: string }> = [];
  for (const row of (rows as any).items ?? []) {
    if (row.sessionId !== sessionId) continue;
    const input = parseAsyncInput(row.input);
    if (!input) continue;
    const running = orchestrator.isRunning(row.id);
    const queued = orchestrator.isQueued(row.id);
    const status = running ? "running" : queued ? "queued" : row.status === "success" ? "completed" : row.status === "failed" ? "failed" : row.status;
    items.push({
      jobId: row.id,
      status,
      taskLabel: input.taskLabel,
      elapsedMs: running ? Date.now() - (row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime()) : undefined,
      subagentSessionId: input.subagentSessionId,
    });
  }
  return items;
}

/**
 * 阻塞等待一个异步任务结束，返回最终结果（唯一调用方：async_task_run(waitForResult=true)。
 * spawn_subagent 的同步等待在 session.ts 自行轮询子会话，不经此函数）。
 * 受 toolCallTimeoutMs 约束（由调用方的 withToolTimeout race 兜底），此处轮询最长 10 分钟。
 */
export async function waitForAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ jobId: string; status: "completed" | "failed"; asyncResult?: string; error?: string }> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const task = await services.task.getById(jobId);
    if (task && (task.status === "success" || task.status === "failed")) {
      const output = parseAsyncOutput(task.output);
      return {
        jobId,
        status: task.status === "success" ? "completed" : "failed",
        asyncResult: output.asyncResult,
        error: output.error,
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { jobId, status: "failed", error: "等待超时（10 分钟）" };
}

/** 停止 subagent session 对应后台任务：必须同时 abort orchestrator 任务并 hub.stop 前端流。
 *  wasRunning 区分运行中/排队中，jobId 供调用方回写 Task 状态。 */
export function stopSubagentSession(
  subagentSessionId: string,
  config: AppConfig,
): { stopped: boolean; wasRunning: boolean; jobId?: string } {
  const orchestrator = getAsyncJobOrchestrator(config);
  const result = orchestrator.stopSubagent(subagentSessionId);
  // 同时中断 SessionStreamHub 中的 SSE 运行，确保前端立即停止流式输出
  getStreamHub()?.stop(subagentSessionId);
  return result;
}

export async function retryAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ jobId: string; status: "running"; message: string }> {
  const existing = await services.task.getById(jobId);
  if (!existing) throw new Error("任务不存在");
  if (existing.status !== "failed") throw new Error("只能重试失败的任务");
  const input = parseAsyncInput(existing.input);
  if (!input) throw new Error("不是有效的异步 Agent 任务");

  const taskLabel = input.taskLabel;
  const agentSnapshot = input.agentSnapshot;
  const mode = input.toolCall ? "tool" : "llm";

  const created = await services.task.create({
    name: `[async] ${taskLabel}`,
    type: "async_agent",
    status: "running",
    sessionId: input.sessionId,
    startedAt: new Date(),
    // 手动 retry 决策：人工是最后一道闸，不受自动重跑计数堵死——retryCount 清零重来、
    // 不再设手动次数上限（原 config.maxRetries 拦截删除）；maxRetries/reentrant 按 config+工具声明重新物化
    retryCount: 0,
    maxRetries: config.asyncJobs.maxRetries,
    reentrant: inferTaskReentrant({ mode, toolCall: input.toolCall, agentTools: agentSnapshot.tools }),
    // 原 input 全量保留（sourceType/deliverToQueue/toolCall/subagentSessionId/shareToSessionIds），
    // 否则 sync 任务重试后 deliverToQueue 缺省为 true，结果漂移进异步队列（S8）
    input,
  } as any);

  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建重试任务失败");
  }

  const newJobId = (created.data as { id: string }).id;
  const orchestrator = getAsyncJobOrchestrator(config);

  try {
    orchestrator.enqueue({
      jobId: newJobId,
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
      execute: buildAsyncExecute(
        config,
        services,
        newJobId,
        input.task,
        agentSnapshot,
        "manual",
        input.subagentSessionId,
        mode,
        input.toolCall,
        input.shareToSessionIds,
        input.sessionId,
      ),
    });
  } catch (err) {
    // 入池拒绝（maxQueued 满）：回收重试 Task 行，错误上抛
    await services.task
      .update({
        id: newJobId,
        status: "failed",
        finishedAt: new Date(),
        output: { error: err instanceof Error ? err.message : String(err) } satisfies AsyncTaskOutput,
      } as any)
      .catch(() => undefined);
    throw err;
  }

  return {
    jobId: newJobId,
    status: "running",
    message: `已启动后台任务「${taskLabel}」的手动重试。`,
  };
}

export interface AsyncQueueStats {
  queued: number;
  runningGlobal: number;
  maxGlobal: number;
  maxPerSession: number;
  /** per-workspace 公平配额（0 = 不限） */
  maxPerWorkspace: number;
  /** 排队总数上限 */
  maxQueued: number;
  taskTimeoutMs: number;
  /** v8 Q2 口径：hub 交互 running（未被池/血缘 claim 的活跃流），准入 = runningGlobal + 它 < maxGlobal */
  hubInteractiveRunning: number;
  runningByWorkspace: Record<string, number>;
  /** 排队任务的阻塞原因分类计数（哪个上限卡住） */
  queuedByReason: Record<"global" | "session" | "workspace", number>;
}

/** 获取异步任务队列实时统计（Q2 口径：runningGlobal = 池内 running + hub 交互 running）。 */
export function getAsyncQueueStats(config: AppConfig): AsyncQueueStats {
  const stats = getAsyncJobOrchestrator(config).getStats();
  return {
    queued: stats.queued,
    runningGlobal: stats.runningGlobal,
    maxGlobal: stats.limits.maxGlobal,
    maxPerSession: stats.limits.maxPerSession,
    maxPerWorkspace: stats.limits.maxPerWorkspace,
    maxQueued: stats.limits.maxQueued,
    taskTimeoutMs: stats.limits.taskTimeoutMs,
    hubInteractiveRunning: stats.hubInteractiveRunning,
    runningByWorkspace: stats.runningByWorkspace,
    queuedByReason: stats.queuedByReason,
  };
}
