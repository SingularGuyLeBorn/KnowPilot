/**
 * TriggerEngine — 事件触发器引擎
 */

import type { PrismaClient } from "@prisma/client";
import type { AppEventBus, EntityEventPayload } from "./eventBus.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { getAppConfig } from "./config.js";
import { runAgent } from "./agentRuntime.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { executeTaskJob } from "./taskRunner.js";
import { claimTaskRun } from "./taskClaim.js";
import { getSwarmOrchestrator, type SwarmTaskOutcome } from "./swarmOrchestrator.js";

/** 脱敏事件 payload 中的敏感字段，防止凭据/密钥被写入 Log.metadata。 */
function sanitizePayloadForLog(payload: unknown): unknown {
  const SENSITIVE_KEYS = /^(password|secret|token|api[-_]?key|authorization|value)$/i;
  const mask = (s: string) => (s.length > 8 ? `${s.slice(0, 4)}••••${s.slice(-4)}` : "••••••••");
  const walk = (val: unknown, depth: number): unknown => {
    if (depth > 5) return "[maxDepth]";
    if (typeof val === "string") return val.length > 2000 ? `${val.slice(0, 2000)}…[truncated]` : val;
    if (Array.isArray(val)) return val.map((v) => walk(v, depth + 1));
    if (val && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.test(k) ? (typeof v === "string" ? mask(v) : "[redacted]") : walk(v, depth + 1);
      }
      return out;
    }
    return val;
  };
  return walk(payload, 0);
}

export class TriggerEngine {
  private isRunning = false;
  private eventHandler: ((payload: EntityEventPayload<any>) => void) | null = null;
  /** P1-2：per-trigger 互斥，防止同一触发器在长 Agent/Task 执行期间被并发事件叠跑 */
  private runningTriggers = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly eventBus: AppEventBus,
    private readonly services: ServiceContainer,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("  ⚡ [TriggerEngine] 启动事件触发器引擎...");

    this.eventHandler = async (payload: EntityEventPayload<any>) => {
      try {
        await this.handleEvent(payload);
      } catch (err: unknown) {
        console.error(
          `  ❌ [TriggerEngine] 事件处理失败 [${payload.entity}.${payload.action}]:`,
          err instanceof Error ? err.message : err,
        );
      }
    };

    this.eventBus.on("*", this.eventHandler);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.eventHandler) {
      this.eventBus.off("*", this.eventHandler);
      this.eventHandler = null;
    }

    console.log("  ⚡ [TriggerEngine] 已停止");
  }

  private async handleEvent(payload: EntityEventPayload<any>): Promise<void> {
    const eventSource = `${payload.entity}.${payload.action}`;

    const triggers = await this.prisma.trigger.findMany({
      where: { source: eventSource, enabled: true },
    });

    if (triggers.length === 0) return;

    console.log(`  ⚡ [TriggerEngine] 匹配到 ${triggers.length} 个触发器 [源: ${eventSource}]`);

    for (const trigger of triggers) {
      // P1-2：per-trigger 互斥 —— 同一触发器正在跑则跳过本次，防叠跑
      if (this.runningTriggers.has(trigger.id)) {
        console.warn(`  ⏭️ [TriggerEngine] 触发器 "${trigger.name}" 正在执行，跳过本次并发触发`);
        continue;
      }
      console.log(`    ↳ 触发动作 [${trigger.name}]: ${trigger.actionType} → ID: ${trigger.actionId}`);

      const exec = (async () => {
        try {
          await this.prisma.log.create({
            data: {
              level: "info",
              component: "trigger.engine",
              event: "trigger.fired",
              message: `触发器 "${trigger.name}" 被事件 "${eventSource}" 触发`,
              // P1-10：脱敏后再写日志，避免凭据/密钥落 Log
              metadata: JSON.stringify({ triggerId: trigger.id, eventPayload: sanitizePayloadForLog(payload) }),
            },
          });

          if (trigger.actionType === "run_task") {
            await this.executeTask(trigger.actionId, payload);
          } else if (trigger.actionType === "run_agent") {
            await this.executeAgent(trigger.actionId, payload);
          } else {
            console.warn(`  ⚠️ [TriggerEngine] 未知动作类型: ${trigger.actionType}`);
          }
        } catch (err: unknown) {
          await this.prisma.log.create({
            data: {
              level: "error",
              component: "trigger.engine",
              event: "trigger.failed",
              message: `触发器 "${trigger.name}" 执行失败: ${err instanceof Error ? err.message : String(err)}`,
              metadata: JSON.stringify({ triggerId: trigger.id, error: String(err) }),
            },
          });
        }
      })();

      this.runningTriggers.set(trigger.id, exec);
      void exec.finally(() => this.runningTriggers.delete(trigger.id));
      // 不 await：让本事件内的多个触发器并行执行，且不阻塞 EventBus.emit
    }
  }

  private async executeTask(taskId: string, triggerPayload: EntityEventPayload<any>): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new Error(`找不到匹配的 Task 记录: ${taskId}`);

    console.log(`    ⚙️ [TriggerEngine] 启动后台任务: ${task.name}`);

    // 先写入触发载荷（不抢 running）；认领单点 = claimTaskRun，与 TaskService/cron 共用
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        input: JSON.stringify({ triggerEvent: triggerPayload }),
      },
    });

    const claimed = await claimTaskRun(this.prisma, taskId);
    if (!claimed) {
      console.warn(`    ⚙️ [TriggerEngine] 任务 "${task.name}" 正在运行，跳过本次触发`);
      return;
    }

    try {
      const output = await executeTaskJob(this.prisma, {
        id: task.id,
        name: task.name,
        type: task.type,
        input: task.input,
      });
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: "success",
          output: JSON.stringify(output),
        },
      });
      console.log(`    ✅ [TriggerEngine] 自动任务执行完毕: ${task.name}`);
    } catch (e: unknown) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: "failed",
          output: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        },
      });
      throw e;
    }
  }

  /** 异步启动 Agent ReAct 循环 */
  private async executeAgent(agentId: string, triggerPayload: EntityEventPayload<any>): Promise<void> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error(`找不到匹配的 Agent 记录: ${agentId}`);

    console.log(`    🤖 [TriggerEngine] 自动唤醒 Agent: ${agent.name}`);

    const config = getAppConfig();
    const invokeTrpc = createTrpcInvoker({ services: this.services, prisma: this.prisma });
    const prompt = `事件 "${triggerPayload.entity}.${triggerPayload.action}" 被触发。请根据关联数据采取适当行动。\n\n数据摘要：\n${JSON.stringify(triggerPayload.data ?? triggerPayload, null, 2).slice(0, 4000)}`;

    // W10：统一走 SwarmOrchestrator 中介者（此前绕过并发池直跑 runAgent）。
    // await completion 保住 per-trigger 互斥语义（runningTriggers 执行完才释放）。
    const orchestrator = getSwarmOrchestrator(config, this.services);
    const handle = await orchestrator.dispatch({
      origin: "trigger",
      schedule: "pool",
      // 无 Chat 会话：以 trigger:agentId 作为并发池 per-session 限流维度
      sessionId: `trigger:${agent.id}`,
      workspaceId: agent.workspaceId ?? null,
      taskLabel: `trigger:${agent.name}`,
      execute: async (): Promise<SwarmTaskOutcome> => {
        const result = await runAgent(
          this.services,
          config,
          { agentId: agent.id, input: prompt },
          invokeTrpc,
        );
        if (!result.success) throw new Error(result.error?.message ?? "Agent 执行失败");
        return { status: "success", content: result.data?.content?.slice(0, 200) };
      },
    });
    const outcome = await handle.completion;
    if (outcome?.status === "failed") throw new Error(outcome.error ?? "Agent 执行失败");

    console.log(`    ✅ [TriggerEngine] Agent 执行完成: ${outcome?.content?.slice(0, 120) ?? ""}`);
  }
}

let _engine: TriggerEngine | null = null;
let _enginePrisma: PrismaClient | null = null;

export function getTriggerEngine(
  prisma: PrismaClient,
  eventBus: AppEventBus,
  services: ServiceContainer,
): TriggerEngine {
  // 测试隔离：prisma 不匹配时重建
  if (_engine && _enginePrisma !== prisma) {
    _engine.stop();
    _engine = null;
    _enginePrisma = null;
  }
  if (!_engine) {
    _engine = new TriggerEngine(prisma, eventBus, services);
    _enginePrisma = prisma;
  }
  return _engine;
}

export function resetTriggerEngineForTests(): void {
  if (_engine) _engine.stop();
  _engine = null;
  _enginePrisma = null;
}
