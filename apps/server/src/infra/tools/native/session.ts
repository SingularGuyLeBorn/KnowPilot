/**
 * Native 会话与运行时域 — session_* / spawn_subagent / task_run / invoke_api
 *
 * PR-4b：从 nativeTools.ts 迁出，handler 与 schema 保持原语义不变。
 * spawn_subagent 复用 swarm 域的 agentCreateSubTool / agentSendMessageTool（单向依赖，无环）。
 */
import fs from "fs";
import path from "path";
import { getStreamHub } from "../../sessionStreamHub.js";
import { runSessionCompact } from "../../autoCompact.js";
import { getAllowedToolsForTier } from "../../swarmPermissionGuard.js";
import { resolveToolsForAgentTier, DEFAULT_SUBAGENT_TOOLS } from "../../loop/setup.js";
import { resolveAgent as defaultResolveAgent } from "../../agentResolver.js";
import { getSwarmOrchestrator, type SwarmTaskOutcome } from "../../swarmOrchestrator.js";
import { getAsyncJobOrchestrator } from "../../asyncJobOrchestrator.js";
import { agentCreateSubTool, agentSendMessageTool } from "./swarm.js";
import {
  coerceToolBoolean,
  type NativeToolContext,
  type NativeToolDefinition,
  type NativeToolHandler,
} from "./types.js";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import { registerNativeDomain } from "./registerDomain.js";

/**
 * spawn waitForResult 轮询的空闲判定（S2）。仅「无流」不够，必须四条件同时满足：
 * - streaming=false：无活跃流；
 * - runStarting=false：无「即将起流」标记（drain 已认领队列项、prepare 段尚未 hub.start——
 *   此间隙队列已空、流未起，缺该条件会被误判空闲，抓到前轮旧 assistant 当本轮派活结果）；
 * - nestedActive=0：子会话内无 running/queued Task；
 * - queuedItems=0：无待处理队列项（前轮结束到 drain 认领之间的窗口由该条件覆盖）。
 */
export function isSubagentSessionSettled(opts: {
  streaming: boolean;
  runStarting: boolean;
  nestedActive: number;
  queuedItems: number;
}): boolean {
  return !opts.streaming && !opts.runStarting && opts.nestedActive === 0 && opts.queuedItems === 0;
}

/** spawn Phase A 产物：子 Agent / 主会话 / 跟踪 Task 的 ids */
interface SpawnPrepared {
  subagentId: string;
  subagentName: string;
  subagentSessionId?: string;
  jobId?: string;
}

/** LLM 主动派生子 Agent：语义明确为「派生一个独立子 Agent 并立即派活」。
 *  底层实现 = agent_create_sub + agent_send_message({ autoRun: true })。
 *  waitForResult=false（默认）= 异步投递：工具立刻返回，子 Agent 自行 report_back 进父异步队列。
 *  waitForResult=true = 同步等待：父流挂起，子会话空闲后系统抓取最后一条 assistant（不强制 report_back）。
 *
 *  v8 TP-1 执行入口统一收口（W10 中介者骨架不动）：
 *  - waitForResult=false：**入池**（schedule pool，Q1 全局池是容量权威）。pool slot 从起流
 *    持有到 hub.waitFor(子会话) 解析；queued 期间跟踪 Task / 子会话状态落 queued（右栏可见「agent 未启动」）。
 *  - waitForResult=true：**槽位血缘继承**（Q4）走 inline 不占新槽——claimOccupancy 把子会话
 *    hub 流从「hub 交互 running」中剔除（父槽位让渡），父流挂起轮询语义不动。
 *  执行体 spawnSubagent* 保留原语义（同步等待/report_back/跟踪 Task 均不动）。 */
async function spawnSubagentTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId || !ctx.agentSnapshot) {
    throw new Error("spawn_subagent 需要在 Chat 会话中调用（缺少 sessionId 或 Agent 上下文）");
  }
  const task = String(args.task || "");
  if (!task.trim()) throw new Error("spawn_subagent 需要 task（子 Agent 任务描述）");
  const waitForResult = coerceToolBoolean(args.waitForResult);
  const parentSnapshot = ctx.agentSnapshot;

  // TP-1：maxSubagentsPerSession 数量检查（manual path 此前无检查——
  // 与 startAsyncAgentTask isSubagent 分支同口径：running/queued 的子会话计数）
  if (ctx.prisma) {
    const limit = ctx.config.asyncJobs.maxSubagentsPerSession;
    const activeCount = await ctx.prisma.chatSession.count({
      where: { parentSessionId: ctx.sessionId, kind: "subagent", status: { in: ["running", "queued"] } },
    });
    if (activeCount >= limit) {
      throw new Error(`已达到每会话子 Agent 上限（${limit}），请先停止或等待已有子 Agent 完成后再派生。`);
    }
  }

  const orchestrator = getSwarmOrchestrator(ctx.config, ctx.services);
  // 中介者权限校验层（与 executeNativeTool 工具层同源输入，纵深防御；tier 缺省时与工具层一致跳过）
  const guard = parentSnapshot.tier
    ? {
        toolName: "spawn_subagent",
        args,
        ctx: {
          agentTier: parentSnapshot.tier,
          agentId: parentSnapshot.id,
          agentWorkspaceId: parentSnapshot.workspaceId,
          inToolRound: ctx.inToolRound ?? false,
        },
      }
    : undefined;

  // 经闭包写入：用 getter 防 TS 控制流把 prepared 窄化为 null
  let preparedSlot: SpawnPrepared | null = null;
  const getPrepared = () => preparedSlot;
  const setPrepared = (p: SpawnPrepared) => {
    preparedSlot = p;
    return p;
  };
  const buildAttach = (p: SpawnPrepared) => ({
    success: true,
    agentId: p.subagentId,
    subagentName: p.subagentName,
    subagentSessionId: p.subagentSessionId,
    jobId: p.jobId,
  });
  const dedupedPayload = (handle: { jobId: string; outcome?: SwarmTaskOutcome }) => {
    const payload = { ...(handle.outcome?.attach ?? {}) };
    return {
      ...payload,
      deduped: true,
      message: `60 秒去重窗口内检测到同 Agent 同任务的重复派生，已返回已有子 Agent 任务（jobId=${(payload.jobId as string | undefined) ?? handle.jobId}），未重复创建。`,
    };
  };

  if (!waitForResult) {
    // ── 异步投递：入池。准备段落 queued 载体；执行体获槽后起流，槽位持有到子会话本轮流结束 ──
    let handle;
    try {
      handle = await orchestrator.dispatch({
        origin: "spawn_subagent",
        schedule: "pool",
        sessionId: ctx.sessionId,
        workspaceId: parentSnapshot.workspaceId ?? null,
        taskLabel: task.slice(0, 80),
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        guard,
        dedup: {
          agentId: parentSnapshot.id,
          taskText: task,
          // 早结 attach：dedup 命中方拿 ids 即返回，不等池任务收口（fire-and-forget）
          earlyOutcome: () => ({ status: "success", attach: buildAttach(getPrepared()!) }),
        },
        prepare: async () => {
          const p = setPrepared(await spawnSubagentPrepare(args, ctx, task, false));
          // 池任务 id = 跟踪 Task id：session.stop / async_task_cancel 同源可取消
          return {
            jobId: p.jobId,
            metadata: p.subagentSessionId ? { subagentSessionId: p.subagentSessionId } : undefined,
          };
        },
        execute: (signal) => spawnSubagentPooledRun(ctx, task, getPrepared()!, signal),
      });
    } catch (err) {
      // 入池拒绝（maxQueued 满）/准备失败：回收 Phase A 产物，避免永远挂在 queued
      const msg = err instanceof Error ? err.message : String(err);
      const prepared = getPrepared();
      if (prepared?.jobId) {
        await ctx.services.task
          .update({ id: prepared.jobId, status: "failed", finishedAt: new Date(), output: { error: msg } } as any)
          .catch(() => undefined);
      }
      if (prepared?.subagentSessionId) {
        await ctx.services.session.update({ id: prepared.subagentSessionId, status: "failed" } as any).catch(() => undefined);
      }
      throw err;
    }

    if (handle.deduped) return dedupedPayload(handle);
    const p = getPrepared()!;
    const queued = handle.status === "queued";
    return {
      ...buildAttach(p),
      jobId: p.jobId ?? handle.jobId,
      status: handle.status,
      message: queued
        ? `子 Agent「${p.subagentName}」(agentId=${p.subagentId}) 已派生并入池排队（全局任务池槽位紧张，获槽后自动启动）；完成后结果会投递回父会话。请牢记返回的 agentId / jobId，勿编造 ID。`
        : `子 Agent「${p.subagentName}」(agentId=${p.subagentId}) 已派生并启动，任务完成后结果会投递回父会话。请牢记返回的 agentId / jobId，勿编造 ID。`,
    };
  }

  // ── 同步等待：槽位血缘继承（Q4）。inline 不占新槽；claim 子会话占用（父槽位让渡），
  // 子会话 hub 流不计入全局占用（Q2 口径），同一血缘同时只有一个执行体占槽 ──
  const pool = getAsyncJobOrchestrator(ctx.config);
  let releaseClaim: () => void = () => {};
  let handle;
  try {
    handle = await orchestrator.dispatch({
      origin: "spawn_subagent",
      schedule: "inline",
      sessionId: ctx.sessionId,
      taskLabel: task.slice(0, 80),
      guard,
      dedup: { agentId: parentSnapshot.id, taskText: task },
      prepare: async () => {
        const p = setPrepared(await spawnSubagentPrepare(args, ctx, task, true));
        if (p.subagentSessionId) releaseClaim = pool.claimOccupancy(p.subagentSessionId);
        return { jobId: p.jobId };
      },
      execute: () => spawnSubagentSyncWait(ctx, task, getPrepared()!),
    });
  } finally {
    // 为什么 finally 还槽：claim 期间子会话 hub 流退出「交互 running」口径（Q4 父槽位让渡），
    // dedup 早返 / prepare 或 execute 抛错任何路径漏还，都会让该会话后续交互流永久不计入全局占用（口径失真）。
    releaseClaim();
  }

  if (handle.deduped) return dedupedPayload(handle);
  return { ...(handle.outcome?.attach ?? {}) };
}

/** spawn Phase A（dispatch 准备段）：创建/解析子 Agent + find-or-create 主会话 + 跟踪 Task。
 *  dedup 命中时不运行（不重复创建）；pool 路径载体落 queued（右栏可见「agent 未启动」）。 */
async function spawnSubagentPrepare(
  args: Record<string, unknown>,
  ctx: NativeToolContext,
  task: string,
  waitForResult: boolean,
): Promise<SpawnPrepared> {
  const parentSnapshot = ctx.agentSnapshot;
  if (!parentSnapshot) throw new Error("spawn_subagent 需要 Agent 上下文");

  // 1. 创建子 Agent（或复用指定 Agent）
  let subagentId: string;
  let subagentName: string;
  if (args.agentId && typeof args.agentId === "string") {
    const resolved = await ctx.services.agent.getById(String(args.agentId));
    if (!resolved) throw new Error("spawn_subagent 指定的 Agent 不存在");
    subagentId = resolved.id;
    subagentName = resolved.name;
  } else {
    const defaultPrompt = waitForResult
      ? `你是上级 Agent 派出的子 Agent。请完成下发的任务，必要时调用工具，并给出最终答复。上级正在同步等待你的回复，无需调用 agent_report_back；写完最终答复即可。\n\n任务：${task}`
      : `你是上级 Agent 派出的子 Agent。请完成下发的任务，必要时调用工具，最终使用 agent_report_back 向上级汇报结果。\n\n任务：${task}`;
    const createResult = await agentCreateSubTool(
      {
        name: args.name ? String(args.name) : `子 Agent ${Date.now().toString(36).slice(-4)}`,
        description: args.description ? String(args.description) : undefined,
        systemPrompt: args.systemPrompt ? String(args.systemPrompt) : defaultPrompt,
        // 默认执行类工具（native: 前缀）；再按 sub tier 裁剪，杜绝物化成空 → native:all
        tools: getAllowedToolsForTier(
          "sub",
          Array.isArray(args.tools) && (args.tools as string[]).length > 0
            ? (args.tools as string[])
            : [...DEFAULT_SUBAGENT_TOOLS],
        ),
        model: args.model ? String(args.model) : undefined,
        apiKey: args.apiKey as string | undefined,
        workspaceId: args.workspaceId,
      },
      ctx,
    );
    if ("error" in createResult) throw new Error(createResult.error as string);
    subagentId = (createResult as { agentId: string }).agentId;
    subagentName = (createResult as { name: string }).name;
    // 默认名时 fire-and-forget 调 LLM 起个正常名字；cuid 不变，父 Agent 仍能靠 agentId 找到
    // （动态 import：后台锦上添花路径，主链路无需加载 sessionAutoName 及其 LLM 依赖）
    if (!args.name && /^子\s*Agent\s+[a-z0-9]+$/i.test(subagentName)) {
      void import("../../sessionAutoName.js")
        .then(({ autoNameAgent }) => autoNameAgent(subagentId, task))
        .catch(() => undefined);
    }
  }

  // 子 Agent 主会话（UI 跳转 + 跟踪 Task 绑定 + 同步等待的完成判定锚点）。
  // 必须在此 find-or-create：prepareAgentRun（agent_send_message autoRun 内）在后台异步建会话，
  // 若这里只 findFirst，首次 spawn 时拿到 undefined → 同步等待循环失去完成判定锚点（只能等 10 分钟超时）。
  // prepareAgentRun 侧 findFirst 会复用此会话（isMainSession 唯一），不会重复创建。
  // pool 路径落 queued（右栏可见「agent 未启动」），获槽后 prepareAgentRun 置 running；
  // inline 路径维持 running（同步等待语义不变）。
  const initialStatus = waitForResult ? "running" : "queued";
  let mainSession = await ctx.prisma?.chatSession.findFirst({
    where: { agentId: subagentId, isMainSession: true, status: { not: "deleted" } },
  });
  if (!mainSession) {
    // W4：与下文一致，优先 ctx 注入的 resolveAgent，缺省回退 agentResolver 叶子模块
    const { agent: subAgent } = await (ctx.resolveAgent ?? defaultResolveAgent)(ctx.services, subagentId);
    const created = await ctx.services.session.create({
      title: `${subAgent?.name ?? subagentName} 主会话`,
      model: subAgent?.model ?? parentSnapshot.model,
      systemPrompt: subAgent?.systemPrompt ?? "",
      agentId: subagentId,
      isMainSession: true,
      kind: "subagent",
      parentSessionId: ctx.sessionId ?? undefined,
      status: initialStatus,
      taskDescription: task.slice(0, 200),
    });
    if (created.success && created.data) {
      mainSession =
        (await ctx.prisma?.chatSession.findUnique({
          where: { id: (created.data as { id: string }).id },
        })) ?? null;
    }
  } else if (!waitForResult) {
    // 复用已有主会话的 pool 路径：获槽前落 queued；busy 场景下 prepareAgentRun 会按 FIFO 接管状态
    try {
      await ctx.services.session.update({ id: mainSession.id, status: "queued" } as any);
      mainSession = { ...mainSession, status: "queued" };
    } catch {
      /* 状态补齐失败不阻塞派生 */
    }
  }
  const subagentSessionId = mainSession?.id;

  // 2. 跟踪 Task：pool 路径 queued + queuedAt；inline 路径 running + startedAt（原语义）。
  // 同步等待时 deliverToQueue=false（结果走 tool return，不进异步队列）。
  let jobId: string | undefined;
  if (ctx.sessionId && typeof ctx.services.task?.create === "function") {
    try {
      const taskLabel = subagentName || `子 Agent ${subagentId.slice(0, 6)}`;
      const created = await ctx.services.task.create({
        name: `[async] ${taskLabel}`,
        type: "async_agent",
        status: initialStatus,
        sessionId: ctx.sessionId,
        queuedAt: waitForResult ? null : new Date(),
        startedAt: waitForResult ? new Date() : null,
        input: {
          kind: "async_agent",
          sessionId: ctx.sessionId,
          task: task.slice(0, 500),
          taskLabel,
          agentSnapshot: {
            id: subagentId,
            model: parentSnapshot.model,
            systemPrompt: "",
            tools: [],
            tier: "sub",
            parentId: parentSnapshot.id,
            workspaceId: parentSnapshot.workspaceId,
            name: subagentName,
          },
          subagentSessionId,
          sourceType: "subagent",
          // 同步等待：结果走 tool return，禁止 autoConsume 二次喂给父会话
          deliverToQueue: !waitForResult,
        },
      } as any);
      if (created.success && created.data) {
        jobId = (created.data as { id: string }).id;
      }
    } catch (err) {
      console.warn("[spawn_subagent] 创建父会话跟踪 Task 失败:", err);
    }
  }

  return { subagentId, subagentName, subagentSessionId, jobId };
}

/** spawn 池内执行体（waitForResult=false）：获槽后起流，槽位持有到 hub.waitFor(子会话) 解析。
 *  跟踪 Task 的终态仍由 report_back 桥接回写（语义不动）；本闭包只覆盖「本轮流」的槽位占用，
 *  子空闲后的 drain 续跑由消费通道各自占槽。 */
async function spawnSubagentPooledRun(
  ctx: NativeToolContext,
  task: string,
  prepared: SpawnPrepared,
  signal: AbortSignal,
): Promise<SwarmTaskOutcome> {
  const { subagentId, subagentName, subagentSessionId, jobId } = prepared;
  const failOutcome = async (error: string): Promise<SwarmTaskOutcome> => {
    if (jobId) {
      await ctx.services.task
        .update({ id: jobId, status: "failed", finishedAt: new Date(), output: { error } } as any)
        .catch(() => undefined);
    }
    return { status: "failed", error, attach: { success: false, agentId: subagentId, subagentName, subagentSessionId, jobId, error } };
  };

  // 获槽起流：跟踪 Task queued → running（右栏从「agent 未启动」转「执行中」）
  if (jobId) {
    await ctx.services.task.update({ id: jobId, status: "running", startedAt: new Date() } as any).catch(() => undefined);
  }

  // Q2 不双算：子会话起流期间 claim 占用（池槽位已计）；release 前 waitFor 已解析，无窗口
  const releaseClaim = subagentSessionId
    ? getAsyncJobOrchestrator(ctx.config).claimOccupancy(subagentSessionId)
    : () => {};
  try {
    if (signal.aborted) return failOutcome("异步任务已取消（未启动）");

    const sendResult = await agentSendMessageTool(
      {
        toAgentId: subagentId,
        content: task,
        messageType: "command",
        autoRun: true,
        // 始终非阻塞首轮；槽位占用在下方 waitFor 闭环
        waitForRun: false,
      },
      ctx,
    );
    if ("error" in sendResult || !sendResult.success) {
      return failOutcome((sendResult as { error?: string }).error ?? "派活失败");
    }

    // 中断/超时（session.stop / async_task_cancel / 池超时）：abort 真正停子会话流
    if (subagentSessionId) {
      const stop = () => getStreamHub()?.stop(subagentSessionId);
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    }

    // 槽位持有到子会话本轮流结束（TP-1）
    const hub = getStreamHub();
    if (hub && subagentSessionId) {
      await hub.waitFor(subagentSessionId);
    }
    if (signal.aborted) return failOutcome("异步任务已取消");
    return { status: "success", attach: { success: true, agentId: subagentId, subagentName, subagentSessionId, jobId } };
  } catch (err) {
    return failOutcome(err instanceof Error ? err.message : String(err));
  } finally {
    releaseClaim();
  }
}

/** spawn 同步等待执行体（waitForResult=true，inline 血缘让渡）：父流挂起。完成条件：
 *  1) 子 Agent 主动 report_back → 跟踪 Task success/failed（提前结束，不进异步队列）
 *  2) 否则：子会话曾运行过（或暖机后）且判定空闲（isSubagentSessionSettled：无流、无「即将起流」
 *     标记、无子会话内 running/queued Task、无待处理队列项）→ 抓取最后一条 assistant */
async function spawnSubagentSyncWait(
  ctx: NativeToolContext,
  task: string,
  prepared: SpawnPrepared,
): Promise<SwarmTaskOutcome> {
  const { subagentId, subagentName, subagentSessionId, jobId } = prepared;

  const sendResult = await agentSendMessageTool(
    {
      toAgentId: subagentId,
      content: task,
      messageType: "command",
      autoRun: true,
      // 始终非阻塞首轮；同步等待在下方轮询子会话空闲 / report_back
      waitForRun: false,
    },
    ctx,
  );

  if ("error" in sendResult || !sendResult.success) {
    if (jobId) {
      await ctx.services.task
        .update({
          id: jobId,
          status: "failed",
          finishedAt: new Date(),
          output: { error: (sendResult as { error?: string }).error ?? "派活失败" },
        } as any)
        .catch(() => undefined);
    }
    return { status: "failed", attach: { error: (sendResult as { error?: string }).error ?? "派活失败" } };
  }

  const waitDeadline = Date.now() + 10 * 60 * 1000;
  const waitStartedAt = Date.now();
  let finalContent = "";
  let finalStatus: "success" | "failed" | "timeout" = "timeout";
  let sawSubStream = false;

  // 为什么轮询而非订阅事件：完成判定有两条路径（report_back 写 Task 终态 / 子会话空闲抓 assistant），
  // 分属 DB 与 StreamHub 两个模块、无统一事件源；400ms 轮询 + 10 分钟硬上限（防父流永久挂起，
  // 与 waitForAsyncJob 同量级）是同时覆盖两条路径的最简判定。
  while (Date.now() < waitDeadline) {
    if (jobId) {
      const row = await ctx.services.task.getById(jobId);
      if (row && (row.status === "success" || row.status === "failed")) {
        finalStatus = row.status as "success" | "failed";
        const out = (row.output ?? {}) as { asyncResult?: string; error?: string };
        finalContent =
          row.status === "success"
            ? out.asyncResult || ""
            : `任务失败：${out.error || "未知错误"}`;
        // v7 通道收敛：deliverToQueue=false 的结果唯一通道是 tool return，永不走队列 CLAIM
        // （autoConsume / pull / reconciler 均以 deliverToQueue≠false 排除）。直接落 delivered=true
        // 闭环交付语义（与 async_task_run 同步路径同口径）；cleanup 只回收 delivered=true 的行。
        await ctx.services.task
          .update({ id: jobId, delivered: true, deliveredAt: new Date() } as any)
          .catch(() => undefined);
        break;
      }
    }

    let streaming = false;
    let runStarting = false;
    if (subagentSessionId) {
      try {
        const hub = getStreamHub();
        streaming = !!hub?.isRunning(subagentSessionId);
        runStarting = !!hub?.isRunStarting(subagentSessionId);
      } catch {
        streaming = false;
      }
    }
    if (streaming) sawSubStream = true;

    let nestedActive = 0;
    if (subagentSessionId && ctx.prisma) {
      nestedActive = await ctx.prisma.task.count({
        where: {
          sessionId: subagentSessionId,
          status: { in: ["running", "queued"] },
        },
      });
    }

    // S2：待处理队列项也算忙——前轮结束到 drain 认领之间队列非空，此时判空闲会抓前轮旧 assistant
    let queuedItems = 0;
    if (subagentSessionId) {
      try {
        queuedItems = ((await ctx.services.sessionQueueItem?.listBySession(subagentSessionId)) ?? []).length;
      } catch {
        queuedItems = 0;
      }
    }

    // 暖机：避免 autoRun 尚未起流时被误判为空闲
    const warmedUp = sawSubStream || Date.now() - waitStartedAt >= 2000;
    if (
      warmedUp &&
      subagentSessionId &&
      ctx.prisma &&
      isSubagentSessionSettled({ streaming, runStarting, nestedActive, queuedItems })
    ) {
      const last = await ctx.prisma.chatMessage.findFirst({
        where: { sessionId: subagentSessionId, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      const text = (last?.content ?? "").trim();
      if (text) {
        finalContent = text;
        finalStatus = "success";
        // 落终态 + delivered=true：同上的 v7 sync 通道交付闭环；asyncResult 供右栏「同步任务」区
        // 与审计追溯，父 Agent 拿到的全文经下方 attach.content 返回。
        if (jobId) {
          await ctx.services.task
            .update({
              id: jobId,
              status: "success",
              finishedAt: new Date(),
              delivered: true,
              deliveredAt: new Date(),
              output: { asyncResult: finalContent },
            } as any)
            .catch(() => undefined);
        }
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  // 无跟踪 Task 且超时前未抓到：最后再尝试一次抓取
  if (!finalContent && subagentSessionId && ctx.prisma) {
    const last = await ctx.prisma.chatMessage.findFirst({
      where: { sessionId: subagentSessionId, role: "assistant" },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (last?.content?.trim()) {
      finalContent = last.content;
      finalStatus = "success";
    }
  }

  if (!finalContent) {
    return {
      status: finalStatus === "success" ? "success" : "failed",
      attach: {
        success: finalStatus === "success",
        agentId: subagentId,
        subagentName,
        subagentSessionId,
        jobId,
        status: finalStatus,
        hint:
          finalStatus === "timeout"
            ? `子 Agent「${subagentName}」(agentId=${subagentId}) 在时限内未完成。可用 agent_inspect(id=该 agentId) 查看进度（勿编造 ID）。`
            : `子 Agent「${subagentName}」未返回有效内容。`,
      },
    };
  }

  return {
    status: finalStatus !== "failed" ? "success" : "failed",
    content: finalContent.slice(0, 500),
    attach: {
      success: finalStatus !== "failed",
      agentId: subagentId,
      subagentName,
      subagentSessionId,
      jobId,
      status: finalStatus,
      content: finalContent,
      hint: `子 Agent「${subagentName}」(agentId=${subagentId}) 已完成。请基于 content 字段生成最终回复；标识请用返回的 agentId/jobId，不要编造 memory key 或虚构 ID。`,
    },
  };
}

async function sessionClearTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (args.confirm !== true) {
    throw new Error("缺少确认：请将 confirm 设为 true 以删除全部 Chat 会话");
  }
  if (!ctx.services?.session?.deleteMany) {
    throw new Error("当前上下文未提供 SessionService，无法执行 session_clear");
  }
  const result = await ctx.services.session.deleteMany();
  return { deletedSessions: result.count };
}

async function sessionCompactTool(_args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId) throw new Error("session_compact 需要在 Chat 会话中调用（缺少 sessionId）");
  if (!ctx.services?.session || !ctx.services?.message) {
    throw new Error("当前上下文未提供 Session/Message Service，无法执行 session_compact");
  }

  const session = await ctx.services.session.getByIdLite(ctx.sessionId);
  if (!session) throw new Error("当前会话不存在");
  if (session.status === "archived") {
    return { success: false, error: "当前会话已归档，无法压缩。" };
  }

  const result = await runSessionCompact({
    config: ctx.config,
    services: ctx.services,
    sessionId: ctx.sessionId,
    model: session.model || ctx.agentSnapshot?.model || ctx.config.llm.defaultModel,
    systemPrompt: session.systemPrompt || ctx.agentSnapshot?.systemPrompt || "你是 KnowPilot 助手。",
    existingSummary: (session as { contextSummary?: string | null }).contextSummary ?? null,
    trigger: "agent",
  });

  if (!result.compacted) {
    return { success: false, message: result.message };
  }

  return {
    success: true,
    message: result.message,
    boundaryMessageId: result.boundaryMessageId,
    messagesSummarized: result.messagesSummarized,
    memoriesFlushed: result.memoriesFlushed,
    generation: result.generation,
  };
}

/**
 * 归档当前会话并开启同 Agent 新会话；总结写入 content/sessions/ 与新会话首条消息。
 * 不自动切换前端视图——通过 SSE session_rotated 提示用户手动跳转。
 */
async function sessionRotateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const summary = String(args.summary ?? "").trim();
  if (!summary) throw new Error("session_rotate 需要非空的 summary");
  if (!ctx.sessionId) throw new Error("session_rotate 需要在 Chat 会话中调用（缺少 sessionId）");
  if (!ctx.services?.session || !ctx.services?.message) {
    throw new Error("当前上下文未提供 Session/Message Service，无法执行 session_rotate");
  }

  const oldSession = await ctx.services.session.getByIdLite(ctx.sessionId);
  if (!oldSession) throw new Error("当前会话不存在");
  if (oldSession.status === "archived") {
    return {
      success: false,
      error: "当前会话已归档，请勿重复调用 session_rotate。",
      oldSessionId: oldSession.id,
      newSessionId: oldSession.rotatedToSessionId ?? undefined,
    };
  }
  if (oldSession.kind === "subagent") {
    throw new Error("子 Agent 任务会话不支持 session_rotate；请在主对话会话中轮换。");
  }

  const agentId = oldSession.agentId ?? ctx.agentSnapshot?.id ?? null;
  if (!agentId) throw new Error("无法确定 Agent，无法创建新会话");

  const reason = args.reason ? String(args.reason).trim() : undefined;
  const carryMemoryIds = Array.isArray(args.carryMemoryIds)
    ? (args.carryMemoryIds as unknown[]).map((id) => String(id)).filter(Boolean)
    : [];

  const oldTitle = String(oldSession.title || "对话").slice(0, 40);
  const newTitle =
    (args.title ? String(args.title).trim() : "") ||
    `${oldTitle} · 续`.slice(0, 60);

  // 1) 写总结文件
  const sessionsDir = path.join(ctx.config.contentDir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const summaryFileName = `${oldSession.id}-summary.md`;
  const summaryPath = path.join(sessionsDir, summaryFileName);
  const summaryDoc = [
    "---",
    `title: "${newTitle} 会话摘要"`,
    `oldSessionId: "${oldSession.id}"`,
    `agentId: "${agentId}"`,
    `reason: "${(reason ?? "session_rotate").replace(/"/g, "'")}"`,
    `rotatedAt: "${new Date().toISOString()}"`,
    "---",
    "",
    summary,
    ""
].join("\n");
  fs.writeFileSync(summaryPath, summaryDoc, "utf8");
  const relativeSummaryPath = path
    .relative(ctx.config.projectRoot, summaryPath)
    .split(path.sep)
    .join("/");

  // 2) 创建新会话
  const created = await ctx.services.session.create({
    title: newTitle,
    model: oldSession.model || ctx.config.llm.defaultModel,
    systemPrompt: oldSession.systemPrompt ?? undefined,
    agentId,
    kind: "chat",
    status: "active",
  } as any);
  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建新会话失败");
  }
  const newSession = created.data as { id: string; title: string };

  // 3) 新会话首条用户消息 = 总结（可选附带 Memory 引用）
  let firstMessage = `【上一会话摘要】\n\n${summary}`;
  if (carryMemoryIds.length > 0) {
    firstMessage += `\n\n【需继续参考的 Memory】\n${carryMemoryIds.map((id) => `- ${id}`).join("\n")}`;
  }
  if (reason) {
    firstMessage += `\n\n（轮换原因：${reason}）`;
  }
  await ctx.services.message.create({
    sessionId: newSession.id,
    role: "user",
    content: firstMessage,
    source: "system",
  } as any);

  // 4) 归档旧会话并记录跳转
  await ctx.services.session.update({
    id: oldSession.id,
    status: "archived",
    contextSummary: summary.slice(0, 20000),
    contextCompactedAt: new Date(),
    rotatedToSessionId: newSession.id,
  } as any);

  // 5) SSE 通知旧会话页面（不自动切换）
  try {
    const hub = getStreamHub();
    hub?.pushExternalEvent(oldSession.id, {
      type: "session_rotated",
      oldSessionId: oldSession.id,
      newSessionId: newSession.id,
      newTitle: newSession.title || newTitle,
      reason,
    });
  } catch (err) {
    console.warn("[session_rotate] SSE 推送失败:", err);
  }

  await ctx.services.log?.create?.({
    level: "info",
    component: "session",
    event: "session_rotated",
    message: `会话 ${oldSession.id} → ${newSession.id}`,
    metadata: {
      oldSessionId: oldSession.id,
      newSessionId: newSession.id,
      reason,
      summaryPath: relativeSummaryPath,
      agentId,
    },
  }).catch(() => {});

  return {
    success: true,
    oldSessionId: oldSession.id,
    newSessionId: newSession.id,
    newTitle: newSession.title || newTitle,
    summaryPath: relativeSummaryPath,
    message: "已归档当前会话并创建新会话。请告知用户可点击提示跳转；不要假设页面已自动切换。",
  };
}

async function taskRunTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = args.id ? String(args.id) : undefined;
  const name = args.name ? String(args.name) : undefined;
  if (!id && !name) throw new Error("必须提供 task id 或 name");

  let taskId = id;
  if (!taskId && name) {
    const result = await ctx.services.task.list({ page: 1, pageSize: 50 });
    const matched = result.items.find((t) => t.name === name);
    if (!matched) throw new Error(`未找到名称为 "${name}" 的 Task`);
    taskId = matched.id;
  }

  const runResult = await ctx.services.task.run(taskId!);
  if (!runResult.success) throw new Error(runResult.error?.message || "Task 执行失败");
  return { taskId, output: runResult.data };
}

async function invokeApiTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.invokeTrpc(String(args.tool), args.args ?? {});
}

const SESSION_DEFS: NativeToolDefinition[] = [
  {
    name: "spawn_subagent",
    description:
      "派生一个独立子 Agent（Subagent）执行长任务。waitForResult=false（默认）=异步投递：工具立刻返回，用户可继续与父 Agent 对话，子 Agent 完成后须调用 agent_report_back，结果进父会话异步任务结果队列。waitForResult=true=同步等待：父流挂起转圈，子会话空闲后系统抓取最后一条 assistant 作为工具返回值（不强制 report_back，也不进异步队列）。",
    parameters: zodParams(
      z.object({
        task: z.string().describe("子 Agent 要执行的任务描述（详细越好）"),
        label: z.string().describe("子 Agent 卡片/队列中显示的简短标签").optional(),
        agentId: z.string().describe("指定子 Agent 使用的 Agent ID（不填则新建）").optional(),
        model: z.string().describe("指定子代理使用的模型 ID（不填则用 Agent 默认模型）").optional(),
        workspaceId: z
          .string()
          .describe("目标 Workspace（仅超级 Agent 可跨 Workspace；默认落在当前父 Agent 所在 Workspace）")
          .optional(),
        timeoutMs: z.number().describe("任务超时毫秒数，不填则使用全局默认值").optional(),
        waitForResult: z
          .boolean()
          .describe("true=同步等待子 Agent 完成并作为工具返回值；false(默认)=异步投递，立刻返回，结果经 report_back 进父异步队列")
          .optional(),
        shareToSessionIds: z.array(z.string()).describe("swarm 协作：结果额外广播到这些会话 id").optional(),
      }),
    ),
  },
  {
    name: "session_clear",
    concurrencyClass: "D",
    description:
      "删除所有 ChatSession 及其关联的 ChatMessage（级联清空）。这是一个破坏性操作，调用时必须将 confirm 显式设为 true。",
    parameters: zodParams(
      z.object({
        confirm: z.boolean().describe("必须设为 true 才会执行清空，否则拒绝调用"),
      }),
    ),
  },
  {
    name: "session_rotate",
    description:
      "当当前会话轮数过多、话题切换或用户要求换干净上下文时调用：归档当前会话，创建同一 Agent 的新会话，并把你写的总结作为新会话第一条用户消息。用户若仍在看旧会话，不会自动跳转，只会收到提示。",
    parameters: zodParams(
      z.object({
        summary: z.string().describe("给新会话用的中文总结（Markdown），需保留目标、决策、未完成事项与关键结论"),
        reason: z.string().describe("轮换原因，如「轮数过多」「话题切换」「用户要求」").optional(),
        title: z.string().describe("新会话标题（可选，默认基于旧标题生成）").optional(),
        carryMemoryIds: z.array(z.string()).describe("需要在新会话首条消息中提及的 Memory id（可选）").optional(),
      }),
    ),
  },
  {
    name: "session_compact",
    description:
      "当用户要求压缩上下文、或当前会话过长需要释放 token 时调用：摘要更早的对话并写入会话摘要，保留最近消息继续聊。与 session_rotate 不同，不会换新会话。",
    parameters: zodParams(
      z.object({
        reason: z.string().describe("压缩原因，如「用户要求」「上下文过长」").optional(),
      }),
    ),
  },
  {
    name: "task_run",
    description: "立即执行一条已注册的后台 Task（如 db:sync）。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("Task id").optional(),
        name: z.string().describe("或按任务名称匹配").optional(),
      }),
    ),
  },
  {
    name: "invoke_api",
    concurrencyClass: "B",
    description: "调用 KnowPilot 后端 tRPC 工具（如 post.list、memory.list）。tool 格式：post.list",
    parameters: zodParams(
      z.object({
        tool: z.string(),
        args: z.record(z.unknown()).describe("JSON 参数对象").optional(),
      }),
    ),
  },
];

const SESSION_HANDLERS: Record<string, NativeToolHandler> = {
  spawn_subagent: spawnSubagentTool,
  session_clear: sessionClearTool,
  session_rotate: sessionRotateTool,
  session_compact: sessionCompactTool,
  task_run: taskRunTool,
  invoke_api: invokeApiTool,
};

export function registerSessionTools(): void {
  registerNativeDomain(SESSION_DEFS, SESSION_HANDLERS);
}
