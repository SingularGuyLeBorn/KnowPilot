/**
 * AgentCronEngine — Agent 自设 cron（与 Heartbeat 正交）
 *
 * - 每次点火 **新建** ChatSession（kind=cron），不复用主会话 / 心跳会话
 * - 首条 user 消息 = 配置的详细 prompt（可选拼接 busPath 文件内容）
 * - 调度走 SwarmOrchestrator 池（origin=cron）
 */
import cron, { type ScheduledTask } from "node-cron";
import fs from "fs/promises";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { getSwarmOrchestrator, type SwarmTaskOutcome } from "./swarmOrchestrator.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { claimExclusiveSessionTaskRun } from "./taskClaim.js";
import { deriveRequiredScopesFromTools } from "./approvalScope.js";
import { resolveSafePath, resolveWithinDir } from "./safePath.js";
import {
  ensureAgentCronJobTable,
  listCronJobs,
  markCronJobRun,
  type AgentCronJobRow,
} from "./agentCronStore.js";

type JobKey = string; // cronJobId

export class AgentCronEngine {
  private jobs = new Map<JobKey, ScheduledTask>();
  private running = new Set<JobKey>();

  constructor(
    private prisma: PrismaClient,
    private services: ServiceContainer,
    private config: AppConfig,
  ) {}

  start(): void {
    void ensureAgentCronJobTable(this.prisma)
      .then(() => this.refresh())
      .catch((err) => {
        console.error(
          "  ⏰ [AgentCronEngine] 建表/加载失败:",
          err instanceof Error ? err.message : err,
        );
      });
    console.log("  ⏰ [AgentCronEngine] 已启动");
  }

  stop(): void {
    for (const task of this.jobs.values()) {
      task.stop();
    }
    this.jobs.clear();
    console.log("  ⏰ [AgentCronEngine] 已停止");
  }

  /** 重建全部 enabled cron 的 node-cron 注册 */
  async refresh(): Promise<void> {
    for (const task of this.jobs.values()) {
      task.stop();
    }
    this.jobs.clear();

    const rows = await listCronJobs(this.prisma, { enabledOnly: true });
    for (const row of rows) {
      this.scheduleOne(row);
    }
    console.log(`  ⏰ [AgentCronEngine] 已挂载 ${this.jobs.size} 条 cron`);
  }

  /** set/clear 后热刷新（本地单用户，全量重建即可） */
  async refreshAgent(_agentId: string): Promise<void> {
    await this.refresh();
  }

  private scheduleOne(row: AgentCronJobRow): void {
    if (!cron.validate(row.cron)) {
      console.warn(`  ⏰ [AgentCronEngine] 非法 cron，跳过 id=${row.id} expr=${row.cron}`);
      return;
    }
    const task = cron.schedule(row.cron, () => {
      void this.fire(row.id);
    });
    this.jobs.set(row.id, task);
  }

  /** 测试 / 手动触发入口 */
  async fire(cronJobId: string): Promise<{ sessionId?: string; error?: string }> {
    if (this.running.has(cronJobId)) {
      return { error: "同任务仍在执行，跳过重叠触发" };
    }
    this.running.add(cronJobId);
    try {
      const rows = await listCronJobs(this.prisma);
      const job = rows.find((r) => r.id === cronJobId);
      if (!job || !job.enabled) {
        return { error: "cron 任务不存在或未启用" };
      }
      const agent = await this.prisma.agent.findUnique({ where: { id: job.agentId } });
      if (!agent || agent.status === "deleted" || agent.status === "dormant") {
        return { error: "目标 Agent 不可用" };
      }
      if (agent.tier === "sub") {
        // 防御：sub 不应持有 cron；若历史脏数据则跳过
        return { error: "子 Agent 不允许执行 cron 任务" };
      }

      const userContent = await this.buildUserContent(job, agent.workspaceId);
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const session = await this.prisma.chatSession.create({
        data: {
          title: `[cron] ${job.name} · ${stamp}`,
          model: agent.model,
          agentId: agent.id,
          kind: "cron",
          isMainSession: false,
          status: "active",
          taskDescription: job.prompt.slice(0, 500),
        },
      });

      await this.services.message.create({
        sessionId: session.id,
        role: "user",
        content: userContent,
        source: "system",
      });

      const tools = agent.tools ? agent.tools.split(",").filter(Boolean) : [];
      const agentSnapshot = {
        id: agent.id,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        tools,
        tier: agent.tier,
        workspaceId: agent.workspaceId,
        parentId: agent.parentId,
      };

      const task = await this.prisma.task.create({
        data: {
          name: `[cron] ${agent.name}/${job.name}`,
          type: "oneshot",
          status: "queued",
          queuedAt: new Date(),
          sessionId: session.id,
          input: {
            kind: "cron",
            agentId: agent.id,
            cronJobId: job.id,
            sessionId: session.id,
            agentSnapshot,
          },
        },
      });

      const orchestrator = getSwarmOrchestrator(this.config, this.services);
      await orchestrator.dispatch({
        origin: "cron",
        schedule: "pool",
        sessionId: session.id,
        workspaceId: agent.workspaceId ?? null,
        jobId: task.id,
        taskLabel: `[cron] ${agent.name}/${job.name}`,
        requiredScopes: deriveRequiredScopesFromTools(tools),
        tools,
        execute: async (signal): Promise<SwarmTaskOutcome> => {
          const claimed = await claimExclusiveSessionTaskRun(this.prisma, task.id, session.id);
          if (!claimed) {
            await this.prisma.task.updateMany({
              where: { id: task.id, status: { in: ["queued", "running"] } },
              data: {
                status: "cancelled",
                finishedAt: new Date(),
                output: { error: "重叠跳过" },
                delivered: true,
                deliveredAt: new Date(),
              },
            });
            await markCronJobRun(this.prisma, job.id, "cancelled", session.id);
            return { status: "failed", error: "重叠跳过" };
          }

          try {
            const { runAgentLoop } = await import("./agentRuntime.js");
            const invokeTrpc = createTrpcInvoker({ services: this.services, prisma: this.prisma });
            const loop = await runAgentLoop({
              config: this.config,
              services: this.services,
              agent: {
                model: agent.model,
                systemPrompt:
                  `${agent.systemPrompt}\n\n` +
                  `你因 cron 定时任务「${job.name}」被唤醒（本次为全新 briefing 会话，无历史对话）。\n` +
                  `【Cron Briefing 铁律】本会话唯一职责：搜集项目/花园/bus 必要现状 → 写出详细可执行 prompt → 调用 session_spawn_goal(model, prompt, mode=goal) 开新会话执行。\n` +
                  `禁止在本会话亲自完成完整交付（不要长链路搜题入库）；执行交给新会话的 goal 外环。可用 write_file 维护 bus。`,
                tools,
              },
              messages: [{ role: "user", content: userContent }],
              invokeTrpc,
              signal,
              sessionId: session.id,
              agentMeta: agentSnapshot,
              runOrigin: "async",
              runInput: {
                cron: true,
                cronJobId: job.id,
                cronName: job.name,
                taskId: task.id,
              },
            });

            await this.prisma.task.update({
              where: { id: task.id },
              data: {
                status: "success",
                finishedAt: new Date(),
                output: { asyncResult: loop.content, tokenUsage: loop.tokenUsage },
                delivered: true,
                deliveredAt: new Date(),
              },
            });
            await this.prisma.chatSession.update({
              where: { id: session.id },
              data: { status: "completed" },
            });
            await markCronJobRun(this.prisma, job.id, "success", session.id);
            console.log(`  ⏰ [AgentCronEngine] ${agent.name}/${job.name} 完成 session=${session.id}`);
            return {
              status: "success",
              content: typeof loop.content === "string" ? loop.content.slice(0, 500) : "cron 完成",
            };
          } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === "AbortError";
            await this.prisma.task
              .update({
                where: { id: task.id },
                data: {
                  status: "failed",
                  finishedAt: new Date(),
                  output: { error: err instanceof Error ? err.message : String(err) },
                  delivered: true,
                  deliveredAt: new Date(),
                },
              })
              .catch(() => {});
            await this.prisma.chatSession
              .update({
                where: { id: session.id },
                data: { status: "failed" },
              })
              .catch(() => {});
            await markCronJobRun(
              this.prisma,
              job.id,
              isAbort ? "cancelled" : "failed",
              session.id,
            );
            return {
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      });

      return { sessionId: session.id };
    } finally {
      this.running.delete(cronJobId);
    }
  }

  private async buildUserContent(
    job: AgentCronJobRow,
    workspaceId: string | null,
  ): Promise<string> {
    const parts = [
      `【Cron Briefing：${job.name}】`,
      `表达式：${job.cron}`,
      ``,
      `本会话是 briefing，不是执行会话。流程：`,
      `1) 用只读/轻量工具摸清现状（如 post_list、读 bus、必要时短读几篇）；`,
      `2) 写出今日完整执行 prompt（含验收标准、禁区、入库目标）；`,
      `3) 调用 session_spawn_goal({ prompt, model, mode: "goal" }) 开新会话并起流；`,
      `4) 回报 newSessionId 后结束。禁止自己做完整交付。`,
      ``,
      job.prompt.trim(),
    ];
    if (job.busPath?.trim()) {
      const busBody = await this.readBusFile(job.busPath.trim(), workspaceId);
      parts.push(
        ``,
        `---`,
        `【File-as-bus：${job.busPath}】`,
        busBody ?? `（文件不存在或不可读，请用 write_file 创建后承接状态）`,
      );
    }
    return parts.join("\n");
  }

  private async readBusFile(
    busPath: string,
    workspaceId: string | null,
  ): Promise<string | null> {
    try {
      let abs: string;
      if (workspaceId) {
        const ws = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { path: true },
        });
        if (ws?.path) {
          const wsRoot = resolveSafePath(this.config, ws.path);
          abs = resolveWithinDir(wsRoot, busPath);
        } else {
          abs = resolveSafePath(this.config, busPath);
        }
      } else {
        abs = resolveSafePath(this.config, busPath);
      }
      const text = await fs.readFile(abs, "utf-8");
      const max = 24_000;
      return text.length > max
        ? `${text.slice(0, max)}\n\n…[bus 截断 original=${text.length}]`
        : text;
    } catch {
      return null;
    }
  }
}

let singleton: AgentCronEngine | null = null;

export function getAgentCronEngine(
  prisma: PrismaClient,
  services: ServiceContainer,
  config: AppConfig,
): AgentCronEngine {
  if (!singleton) {
    singleton = new AgentCronEngine(prisma, services, config);
  }
  return singleton;
}

/** 测试辅助 */
export function __resetAgentCronEngineForTests(): void {
  singleton?.stop();
  singleton = null;
}
