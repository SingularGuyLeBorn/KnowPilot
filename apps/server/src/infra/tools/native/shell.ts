/**
 * Native Shell / Async 域 — run_shell, wait, sleep, async_task_*
 */
import { runShellRestricted, waitMs } from "../../shellRunner.js";
import type { NativeToolContext, NativeToolDefinition } from "./types.js";
import { coerceToolBoolean } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

async function runAsyncTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId || !ctx.agentSnapshot) {
    throw new Error("async_task_run 需要在 Chat 会话中调用（缺少 sessionId 或 Agent 上下文）");
  }
  const { startAsyncAgentTask, waitForAsyncJob } = await import("../../asyncJobManager.js");
  const timeoutMs =
    args.timeoutMs !== undefined ? Math.max(1000, Number(args.timeoutMs)) : undefined;
  const waitForResult = coerceToolBoolean(args.waitForResult);
  const shareToSessionIds = Array.isArray(args.shareToSessionIds)
    ? (args.shareToSessionIds as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : undefined;
  const mode = args.mode === "tool" ? "tool" : "llm";
  const rawToolCall = args.toolCall && typeof args.toolCall === "object" ? (args.toolCall as Record<string, unknown>) : undefined;
  const toolCall = mode === "tool" && rawToolCall
    ? { tool: String(rawToolCall.tool || ""), args: (rawToolCall.args ?? {}) as Record<string, unknown> }
    : undefined;
  if (mode === "tool" && !toolCall?.tool) {
    throw new Error("async_task_run(mode=tool) 需要提供 toolCall.tool 参数");
  }
  const sourceType = mode === "tool" ? "async_task_tool" : "async_task_llm";
  const started = await startAsyncAgentTask({
    sessionId: ctx.sessionId,
    task: String(args.task || ""),
    label: args.label ? String(args.label) : undefined,
    timeoutMs,
    config: ctx.config,
    services: ctx.services,
    agent: ctx.agentSnapshot,
    source: "native_tool:async_task_run",
    isSubagent: false,
    mode,
    toolCall,
    shareToSessionIds,
    // 阻塞等待时结果直接作为工具返回值，禁止再进队列自动消费（避免二次喂给 Agent）
    deliverToQueue: !waitForResult,
    // W10：SwarmOrchestrator 中介者权限校验层（与 executeNativeTool 工具层同源输入，纵深防御；
    // tier 缺省时与工具层一致跳过校验）
    guard: ctx.agentSnapshot.tier
      ? {
          toolName: "async_task_run",
          args: { mode },
          ctx: {
            agentTier: ctx.agentSnapshot.tier,
            agentId: ctx.agentSnapshot.id,
            agentWorkspaceId: ctx.agentSnapshot.workspaceId,
            inToolRound: ctx.inToolRound ?? false,
          },
        }
      : undefined,
  });
  if (!waitForResult) return { ...started, sourceType };
  // 同步等待：结果直接返回。标记 delivered，杜绝 worker 侧误投递 / 竞态二次消费
  const result = await waitForAsyncJob(started.jobId, ctx.config, ctx.services);
  try {
    await ctx.services.task.update({
      id: started.jobId,
      delivered: true,
      deliveredAt: new Date(),
    } as any);
  } catch {
    /* ignore */
  }
  return { ...result, sourceType };
}

async function taskStatusTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { getAsyncJobStatus, listSessionAsyncJobs } = await import("../../asyncJobManager.js");
  const jobId = args.jobId ? String(args.jobId) : undefined;
  if (jobId) return getAsyncJobStatus(jobId, ctx.config, ctx.services);
  if (!ctx.sessionId) return { items: [] };
  return { items: await listSessionAsyncJobs(ctx.sessionId, ctx.config, ctx.services) };
}

async function cancelAsyncTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { cancelAsyncJob } = await import("../../asyncJobManager.js");
  const jobId = String(args.jobId || "");
  if (!jobId) throw new Error("async_task_cancel 需要 jobId");
  return cancelAsyncJob(jobId, ctx.config, ctx.services);
}
async function awaitAsyncTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { waitForAsyncJob } = await import("../../asyncJobManager.js");
  const jobId = String(args.jobId || "");
  if (!jobId) throw new Error("async_task_wait 需要 jobId");
  const result = await waitForAsyncJob(jobId, ctx.config, ctx.services);
  return {
    ...result,
    hint: result.status === "completed"
      ? "任务已完成，请基于上述结果继续生成最终回复。"
      : "任务失败，请告知用户失败原因并建议重试或改用其他方式。",
  };
}

async function runShellTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return runShellRestricted(ctx.config, String(args.command || ""), {
    cwd: args.cwd ? String(args.cwd) : undefined,
    shell: args.shell ? String(args.shell) : undefined,
    timeoutMs: args.timeoutMs !== undefined ? Math.max(1000, Number(args.timeoutMs)) : undefined,
  });
}

async function waitTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const ms =
    args.ms !== undefined
      ? Number(args.ms)
      : Math.round(Number(args.seconds !== undefined ? args.seconds : 1) * 1000);
  if (!Number.isFinite(ms)) throw new Error("seconds/ms 必须是有效数字");
  const result = await waitMs(ms);
  return { ...result, waitedSeconds: result.waitedMs / 1000 };
}

async function sleepTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const seconds = Math.max(0, Math.min(Number(args.seconds !== undefined ? args.seconds : 10), 300));
  if (!Number.isFinite(seconds)) throw new Error("seconds 必须是有效数字");

  // LLM 常把 async 写成字符串 "true"，必须兼容，否则会同步阻塞几十秒看起来像卡死
  const isAsync = coerceToolBoolean(args.async);

  // 非阻塞模式：创建轻量异步定时器任务，时间到后结果进入发送队列
  if (isAsync) {
    if (!ctx.sessionId || !ctx.agentSnapshot) {
      throw new Error("sleep(async=true) 需要在 Chat 会话中调用（缺少 sessionId 或 Agent 上下文）");
    }
    const { startAsyncSleepTask } = await import("../../asyncJobManager.js");
    return startAsyncSleepTask({
      sessionId: ctx.sessionId,
      seconds,
      config: ctx.config,
      services: ctx.services,
      agentSnapshot: ctx.agentSnapshot,
    });
  }

  const ms = Math.round(seconds * 1000);
  const result = await waitMs(ms);
  return {
    ...result,
    waitedSeconds: result.waitedMs / 1000,
    message: `定时时间${seconds}s到了，请继续完成任务`,
    hint: `定时时间${seconds}s到了，请继续完成任务`,
  };
}

const SHELL_DEFS: NativeToolDefinition[] = [
  {
    name: "async_task_run",
    concurrencyClass: "A",
    description: "启动后台任务（入全局任务池 queued→running）。waitForResult=false（默认）=异步投递：立刻返回，完成后结果进会话异步任务结果队列。waitForResult=true=同步等待：父流挂起直到任务完成，结果作为工具返回值（不进异步队列）。子 Agent 只能用 mode=tool（纯工具执行），不可发起带 LLM 的后台任务。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "交给后台 Agent 执行的任务描述" },
        label: { type: "string", description: "任务标签，用于前端展示" },
        mode: { type: "string", enum: ["llm", "tool"], description: "llm=后台 Agent 跑 LLM 循环（仅主/管理 Agent 可用）；tool=纯工具一次性执行（子 Agent 必须用此模式）。默认 llm" },
        toolCall: { type: "object", description: "mode=tool 时必填：{ tool: 工具名, args: 工具参数 }", properties: { tool: { type: "string" }, args: { type: "object" } } },
        timeoutMs: { type: "number", description: "任务最大运行时长毫秒数，不填用全局默认值" },
        waitForResult: { type: "boolean", description: "true=同步等待完成并作为工具返回值；false(默认)=异步投递，立刻返回，结果进队列" },
        shareToSessionIds: { type: "array", items: { type: "string" }, description: "swarm 协作：结果额外广播到这些会话 id" },
      },
      required: ["task"],
    },
  },
  {
    name: "async_task_status",
    concurrencyClass: "A",
    description: "查询异步任务状态。可传 jobId 查单个，不传则列当前会话全部任务。返回状态、已执行/排队时长、结果/错误、执行日志等。",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "任务 id（async_task_run 返回的 jobId），不传则列出当前会话全部任务" },
      },
    },
  },
  {
    name: "async_task_wait",
    concurrencyClass: "B",
    description: "显式等待异步任务完成（阻塞当前轮，最长 10 分钟，不受默认工具超时限制）。任务完成后返回结果，LLM 基于结果继续生成最终答案。",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "要等待的任务 id" },
      },
      required: ["jobId"],
    },
  },
  {
    name: "async_task_cancel",
    concurrencyClass: "A",
    description: "取消一条运行中或排队中的异步任务/Subagent。",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "要取消的任务 id" },
      },
      required: ["jobId"],
    },
  },
  {
    name: "run_shell",
    concurrencyClass: "C",
    description:
      "在项目根目录内执行 Shell 命令（host_restricted：超时/输出上限/危险命令拦截）。Windows 默认 PowerShell，Linux/macOS 默认 bash。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令，如 pnpm test 或 dir" },
        cwd: { type: "string", description: "相对项目根的工作目录，默认 ." },
        shell: { type: "string", enum: ["auto", "powershell", "cmd", "bash"], description: "Shell 类型，默认 auto" },
        timeoutMs: { type: "number", description: "命令超时毫秒数，不填则使用全局默认值" },
      },
      required: ["command"],
    },
  },
  {
    name: "wait",
    concurrencyClass: "A",
    description: "等待指定时间（用于安装、服务启动、轮询前的延迟）。最多 300 秒。",
    parameters: {
      type: "object",
      properties: {
        seconds: { type: "number", description: "等待秒数，默认 1，最大 300" },
        ms: { type: "number", description: "或直接指定毫秒数（与 seconds 二选一）" },
      },
    },
  },
  {
    name: "sleep",
    concurrencyClass: "A",
    description:
      "睡眠/定时器：阻塞等待 N 秒后返回（默认 10 秒，最大 300 秒）。设置 async=true 则不阻塞当前对话，改为创建后台异步任务，时间到后结果进入发送队列最前，可用于定时提醒。",
    parameters: {
      type: "object",
      properties: {
        seconds: { type: "number", description: "等待秒数，默认 10，最大 300" },
        async: { type: "boolean", description: "true=不阻塞，创建后台异步任务；false(默认)=阻塞当前对话" },
      },
    },
  }
];

const SHELL_HANDLERS = {
  async_task_run: runAsyncTool,
  async_task_status: taskStatusTool,
  async_task_wait: awaitAsyncTool,
  async_task_cancel: cancelAsyncTool,
  run_shell: runShellTool,
  wait: waitTool,
  sleep: sleepTool,
};

export function registerShellTools(): void {
  registerNativeDomain(SHELL_DEFS, SHELL_HANDLERS);
}
