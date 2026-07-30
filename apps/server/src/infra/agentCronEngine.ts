/**
 * AgentCronEngine — Agent 自设 cron（与 Heartbeat 正交）
 *
 * - 每次点火 **新建** ChatSession（kind=cron），不复用主会话 / 心跳会话
 * - 经 SessionStreamHub **交互式起流**（不入全局异步池）：避免审批 gate / 池排队导致
 *   「立刻跑一次」看起来完全没反应；Chat 可订阅 SSE 看 briefing 进度
 * - 首条 user 消息由 chatAgentStream 落库；可选 busPath 拼进首条内容
 */
import cron, { type ScheduledTask } from "node-cron";
import fs from "fs/promises";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { resolveSafePath, resolveWithinDir } from "./safePath.js";
import {
  ensureAgentCronJobTable,
  listCronJobs,
  markCronJobRun,
  type AgentCronJobRow,
} from "./agentCronStore.js";
import { getStreamHub, onHubRunSettled } from "./sessionStreamHub.js";

type JobKey = string; // cronJobId

export class AgentCronEngine {
  private jobs = new Map<JobKey, ScheduledTask>();
  private running = new Set<JobKey>();
  /** sessionId → cronJobId，供 hub settled 回写 lastRun* */
  private sessionToCron = new Map<string, string>();
  private unsubSettled: (() => void) | null = null;

  constructor(
    private prisma: PrismaClient,
    private services: ServiceContainer,
    private config: AppConfig,
  ) {}

  private ensureSettledHook(): void {
    if (this.unsubSettled) return;
    this.unsubSettled = onHubRunSettled((sessionId) => {
      void this.onSessionSettled(sessionId);
    });
  }

  start(): void {
    this.ensureSettledHook();
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
    this.unsubSettled?.();
    this.unsubSettled = null;
    this.sessionToCron.clear();
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

  private async onSessionSettled(sessionId: string): Promise<void> {
    const cronJobId = this.sessionToCron.get(sessionId);
    if (!cronJobId) return;
    this.sessionToCron.delete(sessionId);
    try {
      const session = await this.prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      const status =
        session?.status === "failed" || session?.status === "paused"
          ? "failed"
          : session?.status === "archived"
            ? "cancelled"
            : "success";
      await markCronJobRun(this.prisma, cronJobId, status, sessionId);
      console.log(`  ⏰ [AgentCronEngine] 会话收尾 session=${sessionId} → ${status}`);
    } catch (err) {
      console.warn(
        `  ⏰ [AgentCronEngine] 回写 lastRun 失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** 测试 / 手动触发 / 定时点火入口 */
  async fire(cronJobId: string): Promise<{ sessionId?: string; error?: string }> {
    this.ensureSettledHook();
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
        return { error: "子 Agent 不允许执行 cron 任务" };
      }

      const userContent = await this.buildUserContent(job, agent.workspaceId);
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      // 走 SessionService：触发 afterCreate → session_list_changed（推拉铁律）
      const created = await this.services.session.create({
        title: `[cron] ${job.name} · ${stamp}`,
        model: agent.model,
        agentId: agent.id,
        kind: "cron",
        isMainSession: false,
        status: "active",
        taskDescription: job.prompt.slice(0, 500),
      });
      if (!created.success || !created.data) {
        return { error: created.error?.message ?? "创建 cron 会话失败" };
      }
      const session = created.data as { id: string; title: string };

      // 立刻回写「运行中」，管理页不再显示「从未运行」假象（markCronJobRun 内推 cron_job_updated）
      await markCronJobRun(this.prisma, job.id, "running", session.id);

      const hub = getStreamHub();
      if (!hub) {
        await markCronJobRun(this.prisma, job.id, "failed", session.id);
        return { sessionId: session.id, error: "StreamHub 未就绪，请确认 server 已完整启动" };
      }

      const body = {
        sessionId: session.id,
        message: userContent,
        model: agent.model,
        source: "cron" as const,
        agentId: agent.id,
        toolResults: {
          cron: { jobId: job.id, name: job.name, cron: job.cron },
        },
      };

      const invoke = createTrpcInvoker({
        services: this.services,
        config: this.config,
        prisma: this.prisma,
      });

      this.sessionToCron.set(session.id, job.id);

      let started: "started" | "duplicate" | "busy";
      try {
        started = await hub.startIfNotRunning(session.id, body, (emit, signal) =>
          import("./agentStream.js").then(({ chatAgentStream }) =>
            chatAgentStream(this.services, this.config, body, invoke, emit, signal),
          ),
        );
      } catch (err) {
        this.sessionToCron.delete(session.id);
        await markCronJobRun(this.prisma, job.id, "failed", session.id);
        return {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (started !== "started") {
        this.sessionToCron.delete(session.id);
        await markCronJobRun(this.prisma, job.id, "failed", session.id);
        return {
          sessionId: session.id,
          error: started === "busy" ? "会话占线，未能起流" : "重复起流被拒绝",
        };
      }

      // 通知该 Agent 主会话：其它已打开的 Chat 标签页刷新侧栏，无需整页刷新
      try {
        const main = await this.prisma.chatSession.findFirst({
          where: { agentId: agent.id, isMainSession: true, status: { not: "archived" } },
          select: { id: true },
        });
        if (main && main.id !== session.id) {
          hub.pushExternalEvent(main.id, {
            type: "cron_session_started",
            agentId: agent.id,
            sessionId: session.id,
            cronJobId: job.id,
            cronName: job.name,
            title: session.title,
          });
        }
      } catch {
        /* 侧栏通知失败不影响点火 */
      }

      console.log(
        `  ⏰ [AgentCronEngine] 已起流 ${agent.name}/${job.name} session=${session.id}`,
      );
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
