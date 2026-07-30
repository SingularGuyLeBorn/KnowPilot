/**
 * ChatSession Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateSessionInput,
  UpdateSessionInput,
  ListSessionsInput,
  AgentChatInput,
  OperationResult,
  NextStep,
} from "@knowpilot/shared";
import { TRPCError } from "@trpc/server";
import {
  BaseService,
  ServiceValidationError,
  failureFromPrismaUnique,
  type PaginatedResult,
} from "../../services.js";
import { success, failureFromError } from "../../trpc/result.js";

export interface SessionEntity {
  id: string;
  title: string;
  autoName?: string | null;
  model: string;
  systemPrompt: string | null;
  agentId: string | null;
  // Swarm/Subagent 扩展字段（数据库有默认值，普通会话可省略）
  parentSessionId?: string | null;
  kind?: "chat" | "subagent";
  status?: import("@knowpilot/shared").SessionStatus;
  taskDescription?: string | null;
  isMainSession?: boolean;
  contextSummary?: string | null;
  contextCompactedAt?: Date | string | null;
  rotatedToSessionId?: string | null;
  rotatedFromSessionId?: string | null;
  /** 会话级待办清单（todo_write / todo_read） */
  todoState?: unknown | null;
  /** 会话树当前叶消息 id */
  activeLeafId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionService extends BaseService<CreateSessionInput, UpdateSessionInput, ListSessionsInput, SessionEntity> {
  readonly entityName = "session";
  protected get delegate() { return this.prisma.chatSession; }
  protected formatEntity(raw: any): SessionEntity { return raw; }
  // 会话列表按 updatedAt 排序：用户在旧会话发消息后，MessageService.afterCreate 会刷新
  // session.updatedAt，使该会话浮到侧栏顶部。原默认 createdAt 排序导致旧会话永远停在原位。
  protected override get defaultOrderBy(): string { return "updatedAt"; }

  protected buildListWhere(input: ListSessionsInput): any {
    const where: any = {};
    if (input.keyword) where.title = { contains: input.keyword };
    if (input.agentIds && input.agentIds.length > 0) where.agentId = { in: input.agentIds };
    if (input.parentSessionId !== undefined) where.parentSessionId = input.parentSessionId;
    // 显式 kind=skill_review|heartbeat 走旁路入口（listSideRuns 等）；
    // 对话历史默认排除，避免系统旁路会话污染侧栏。
    if (input.kind) where.kind = input.kind;
    else where.kind = { notIn: ["skill_review", "heartbeat"] };
    if (input.status) where.status = input.status;
    return where;
  }

  // A1：agentIds 批量模式不分页，一次拉回所有匹配会话（take 上限 500），
  // 供 WorkspaceTree 在内存按 agentId 分组，消除「每个展开 Agent 一次查询」的 N+1。
  async list(input: ListSessionsInput): Promise<PaginatedResult<SessionEntity>> {
    if (input.agentIds && input.agentIds.length > 0) {
      const where = this.buildListWhere(input);
      const items = await this.delegate.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
      const formatted = items.map((i: any) => this.formatEntity(i));
      return { items: formatted, total: formatted.length, page: 1, pageSize: formatted.length, totalPages: 1 };
    }
    return super.list(input);
  }

  protected buildCreateData(input: CreateSessionInput): any {
    const { parentSessionId, kind, taskDescription, status, goalState, ...rest } = input;
    return {
      ...rest,
      ...(parentSessionId !== undefined ? { parentSessionId } : {}),
      ...(kind ? { kind } : {}),
      ...(taskDescription !== undefined ? { taskDescription } : {}),
      ...(status ? { status } : {}),
      ...(goalState !== undefined ? { goalState: goalState ?? undefined } : {}),
    };
  }
  protected buildUpdateData(input: UpdateSessionInput): any {
    const { id: _id, status, taskDescription, goalState, ...data } = input;
    return {
      ...data,
      ...(status ? { status } : {}),
      ...(taskDescription !== undefined ? { taskDescription } : {}),
      ...(goalState !== undefined ? { goalState: goalState === null ? null : goalState } : {}),
    };
  }

  protected override async afterCreate(entity: SessionEntity, input: CreateSessionInput): Promise<void> {
    await super.afterCreate(entity, input);
    if (!entity.agentId) return;
    const { notifyAgentUi } = await import("../uiStateNotify.js");
    await notifyAgentUi(this.prisma, entity.agentId, {
      type: "session_list_changed",
      agentId: entity.agentId,
      sessionId: entity.id,
      reason: "create",
    });
  }

  /**
   * 列表可见字段变更才推（status/title/血缘等）。
   * 跳过 contextSummary / goalState / todoState 等高频写，避免 SSE 风暴。
   */
  protected override async afterUpdate(
    entity: SessionEntity,
    existing: any,
    input: UpdateSessionInput,
  ): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    const agentId = entity.agentId ?? existing?.agentId;
    if (!agentId) return;
    const listAffecting =
      input.status !== undefined ||
      input.title !== undefined ||
      input.autoName !== undefined ||
      input.kind !== undefined ||
      input.parentSessionId !== undefined ||
      input.isMainSession !== undefined ||
      input.rotatedToSessionId !== undefined ||
      input.rotatedFromSessionId !== undefined ||
      input.agentId !== undefined;
    if (!listAffecting) return;
    const { notifyAgentUi } = await import("../uiStateNotify.js");
    await notifyAgentUi(this.prisma, agentId, {
      type: "session_list_changed",
      agentId,
      sessionId: entity.id,
      reason: "update",
    });
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    if (!existing?.agentId) return;
    const { notifyAgentUi } = await import("../uiStateNotify.js");
    await notifyAgentUi(this.prisma, existing.agentId, {
      type: "session_list_changed",
      agentId: existing.agentId,
      sessionId: existing.id,
      reason: "delete",
    });
  }

  /**
   * P11 不变量：每 Agent 至多一条 isMainSession=true（与 ensureMainSession 同源）。
   * 新建/提升主会话前摘掉同 Agent 其它主会话标记，避免 prepareAgentRun findFirst
   * 命中「空壳主会话」而测试/业务占用的是另一条 isMainSession 会话。
   */
  private async demoteOtherMainSessions(agentId: string, exceptId?: string): Promise<void> {
    await this.prisma.chatSession.updateMany({
      where: {
        agentId,
        isMainSession: true,
        status: { not: "deleted" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isMainSession: false },
    });
  }

  override async create(input: CreateSessionInput): Promise<OperationResult<SessionEntity>> {
    if (input.isMainSession && input.agentId) {
      await this.demoteOtherMainSessions(input.agentId);
    }
    return super.create(input);
  }

  override async update(input: UpdateSessionInput): Promise<OperationResult<SessionEntity>> {
    if (input.isMainSession === true) {
      const existing = await this.prisma.chatSession.findUnique({
        where: { id: input.id },
        select: { agentId: true },
      });
      if (existing?.agentId) {
        await this.demoteOtherMainSessions(existing.agentId, input.id);
      }
    }
    return super.update(input);
  }

  override async getById(id: string): Promise<any> {
    // P0-1 彻底解耦：getById 只返会话元数据（title/model/agentId/kind/status...），不含 messages。
    // 消息由前端 useInfiniteQuery 走 message.listForChat（cursor 分页）独立加载。
    const session = await this.prisma.chatSession.findUnique({ where: { id } });
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    return session;
  }

  // A4：轻量 getById，不 include messages。供 stop/rerun 等只需 kind/status 的场景使用，
  // 避免每次拉 500 条消息。
  async getByIdLite(id: string): Promise<any> {
    const session = await this.prisma.chatSession.findUnique({ where: { id } });
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    return session;
  }

  /**
   * C-3 会话手动恢复（v10）：paused → running 续跑未完成的 ReAct 轮。
   *
   * 背景：服务端重启后 R-2 把僵尸 running 会话标 paused（进程内 ReAct 状态随进程死亡，
   * 消息链在 ChatMessage 表扁平存储，chatAgentStream 从扁平链重建上下文续跑，
   * 不重复生成已有 assistant 消息）。设计：手动恢复，不做自动恢复。
   *
   * 不变量（全部收条件写/原子操作，不靠编排层时序猜测）：
   * 1. 仅 status="paused" 可恢复；active/failed/archived/completed 等 → BAD_REQUEST（说明原因）。
   * 2. resume 互斥点 = 条件写 updateMany where {id, status:"paused"} → {status:"running"}：
   *    count=1 获得恢复权；count=0 重读——已 running → 幂等返回（并发 double-resume
   *    落选方不报错、不重复起流）；其它 → BAD_REQUEST。
   *    普通发消息走 Hub.start 的 claim（active|paused→running），与此处幂等叠加。
   * 3. 系统提示消息（role:"user", source:"system"）由 chatAgentStream 在起流后写入——
   *    注入与起流同源，不存在「消息已写、流未起」的孤儿窗口，故回滚无需删消息。
   * 4. 起流失败回滚（宁漏勿错）：startIfNotRunning 返回 false = 已有活跃流接管
   *    （竞态幂等，状态维持 running，不算失败）；抛错 → 条件写回滚 running→paused。
   *    可判定依据：hub.start 的全部抛错点都在 runs 占位与 runner 执行之前
   *    （isRunning 检查；maxEventIdFor 内部已吞错不抛），抛错 ⟹ runner 未执行
   *    ⟹ 消息必然未写入 ⟹ 回滚安全完整。回滚同走条件写 where status:"running"：
   *    期间已被 stop/接管则 count=0 不误滚。
   * 5. 终态归位收进 SessionStreamHub.start（所有起流路径共用）：run 结束时若仍 running——
   *    done → subagent/skill_review "completed" / 其它 "active"；error/中断 → "paused"。
   *    resume 不再重复 settle；条件写 where status:"running" 保证与 stop/report_back 不覆盖。
   */
  async resume(input: { id: string }): Promise<{
    id: string;
    status: string;
    resumed: boolean;
    streamStarted: boolean;
    /** 队首为 superior 时：已挂服务端 drain，未注入「继续任务」并行流 */
    superiorDrainQueued?: boolean;
  }> {
    const session = await this.getByIdLite(input.id); // 不存在 → NOT_FOUND

    // 互斥点（唯一）：条件写抢占恢复权
    const claim = await this.prisma.chatSession.updateMany({
      where: { id: input.id, status: "paused" },
      data: { status: "running" },
    });

    if (claim.count === 0) {
      // 未获得恢复权：重读当前状态，区分「幂等」与「拒绝」
      const current = await this.getByIdLite(input.id);
      if (current.status === "running") {
        // 并发 double-resume 落选方 / 重复调用：不报错、不重复起流
        return { id: input.id, status: "running", resumed: false, streamStarted: false };
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `恢复会话失败：仅「已暂停（paused）」的会话可恢复运行，当前状态为「${current.status}」。` +
          (current.status === "archived" ? "已归档会话请前往续写会话。" : "请刷新会话列表确认状态后重试。"),
      });
    }

    // 获得恢复权。起流走交互式通道（v8 Q2 口径：不入池但计入全局占用——
    // hub.runningCount() 即交互 running 计数，池准入据此约束，不新造限流层）。
    // infra 全部动态 import 防环（agentStream 处于 ReAct 依赖环内，与 SessionService.delete 同模式）。
    const { getStreamHub } = await import("../sessionStreamHub.js");
    const hub = getStreamHub();
    if (!hub) {
      // 未起流（runner 未执行、消息未写入）→ 安全回滚
      await this.prisma.chatSession.updateMany({
        where: { id: input.id, status: "running" },
        data: { status: "paused" },
      });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "恢复会话失败：StreamHub 未初始化，已回滚为 paused，请重试。",
      });
    }

    const { getServiceContainer } = await import("../serviceContainer.js");
    const services = getServiceContainer(this.prisma, this.eventBus, this.config);
    const config = this.config;

    // 队首 superior：只挂服务端 drain，禁止与「继续任务」并行起流（保 FIFO）
    const queueHead = (await services.sessionQueueItem.listBySession(input.id))[0];
    if (queueHead?.kind === "superior" && session.agentId) {
      const { enqueueSuperiorDrainForSession } = await import("../tools/native/swarm.js");
      const drainPromise = enqueueSuperiorDrainForSession({
        sessionId: input.id,
        targetAgentId: session.agentId,
        config,
        services,
      });
      drainPromise
        .finally(async () => {
          if (hub.isRunning(input.id)) return;
          // 与 Hub.settleSessionDbStatus 对齐：subagent / skill_review → completed
          const nextStatus =
            session.kind === "subagent" || session.kind === "skill_review" ? "completed" : "active";
          await this.prisma.chatSession
            .updateMany({
              where: { id: input.id, status: "running" },
              data: { status: nextStatus },
            })
            .catch((settleErr) => {
              console.warn(`[session.resume] superior drain 后归位失败 session=${input.id}:`, settleErr);
            });
        })
        .catch((err) => {
          console.warn(`[session.resume] superior drain 链失败 session=${input.id}:`, err instanceof Error ? err.message : err);
        });
      return {
        id: input.id,
        status: "running",
        resumed: true,
        streamStarted: false,
        superiorDrainQueued: true,
      };
    }

    // 优先 drain 队首孤儿 ask_user 答复（重启后无 waiter 入队的项）：以答复起流，勿盲目「继续任务」
    const orphanAnswer = await services.sessionQueueItem.claimHeadAskUserOrphan(input.id);
    const { buildResumeHintIfAskPending } = await import("../askUserGate.js");
    const askHint = orphanAnswer ? null : buildResumeHintIfAskPending(input.id);
    // 用户软暂停（assistant finishReason=aborted）与重启尸体会话分叉提示
    let continueHint = "（服务已重启，请继续完成未完成的任务）";
    if (!orphanAnswer && !askHint) {
      const lastAssistant = await this.prisma.chatMessage.findFirst({
        where: { sessionId: input.id, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { finishReason: true },
      });
      if (lastAssistant?.finishReason === "aborted") {
        continueHint =
          "（用户暂停了生成，请根据已有对话与工具结果，从中断处继续完成任务）";
      }
    }
    const body: AgentChatInput = {
      sessionId: input.id,
      agentId: session.agentId ?? undefined,
      message: orphanAnswer?.content ?? askHint ?? continueHint,
      // 孤儿答复按用户消息上链；其余恢复注入走 system 去重路径
      source: orphanAnswer ? "user" : "system",
      // 子任务血统允许 report_back（与 asyncJobManager autoConsume 同口径）
      runOrigin: session.parentSessionId || session.kind === "subagent" ? "parent" : "user",
    };

    const { createTrpcInvoker } = await import("../trpcInvoker.js");
    const invokeTrpc = createTrpcInvoker({ services });
    const { chatAgentStream } = await import("../agentStream.js");
    type AgentStreamEvent = import("../agentStream.js").AgentStreamEvent;

    try {
      const started = await hub.startIfNotRunning(input.id, body, async (emit, signal) => {
        // chatAgentStream 自身吞错并 emit error 事件（不 rethrow），
        // 只能追踪事件流判定终局；防御性 catch 兜底未来改动。
        // 用对象持有终局标记：绕过 TS 对闭包捕获变量的窄化（闭包内赋值不被 CFA 追踪）
        const track = { terminal: "error" as "done" | "error" };
        const trackingEmit = (event: AgentStreamEvent) => {
          if (event.type === "done") track.terminal = "done";
          else if (event.type === "error") track.terminal = "error";
          emit(event);
        };
        try {
          await chatAgentStream(services, config, body, invokeTrpc, trackingEmit, signal);
        } catch {
          track.terminal = "error";
        }
        // B2：孤儿 ask_user 答复已写入 ChatMessage 后才 finalize 删行；失败保留 claimedAt 交恢复
        if (orphanAnswer && track.terminal === "done") {
          await services.sessionQueueItem.finalize(orphanAnswer.id).catch((finErr) => {
            console.warn(`[session.resume] finalize ask_user 队列项失败 item=${orphanAnswer.id}:`, finErr);
          });
        }
        // 终态归位（runner 内、hub 标 completed 之前，见头注 5）。
        const nextStatus =
          track.terminal === "done" ? (session.kind === "subagent" ? "completed" : "active") : "paused";
        try {
          await this.prisma.chatSession.updateMany({
            where: { id: input.id, status: "running" },
            data: { status: nextStatus },
          });
        } catch (settleErr) {
          // 归位失败不阻塞流本身：R-2 重启首扫会把尸体 running 再标 paused，留人工恢复
          console.warn(`[session.resume] 终态归位失败 session=${input.id}:`, settleErr);
        }
      });

      if (started !== "started") {
        // 已有活跃流接管（busy/duplicate）：竞态幂等，状态维持 running
        return { id: input.id, status: "running", resumed: true, streamStarted: false };
      }
      return { id: input.id, status: "running", resumed: true, streamStarted: true };
    } catch (err) {
      // startIfNotRunning 抛错 ⟹ runner 未执行 ⟹ 系统消息必然未写入 ⟹ 安全回滚（头注 4）
      await this.prisma.chatSession
        .updateMany({
          where: { id: input.id, status: "running" },
          data: { status: "paused" },
        })
        .catch((rbErr) => {
          console.warn(`[session.resume] 回滚 paused 失败 session=${input.id}:`, rbErr);
        });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `恢复会话失败：启动续跑流异常（${err instanceof Error ? err.message : String(err)}），已回滚为 paused，请重试。`,
      });
    }
  }

  async deleteMany(_input?: Record<string, never>): Promise<{ count: number }> {
    // 先清无 FK 级联的附属数据，再删会话（ChatMessage / SessionQueueItem 会 cascade）
    await this.prisma.sessionStreamEvent.deleteMany({}).catch((err) => {
      console.warn("[session.deleteMany] streamEvent 清空失败:", err instanceof Error ? err.message : err);
      return { count: 0 };
    });
    await this.prisma.task.deleteMany({
      where: { OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }] },
    }).catch((err) => {
      console.warn("[session.deleteMany] async task 清空失败:", err instanceof Error ? err.message : err);
      return { count: 0 };
    });
    const result = await this.prisma.chatSession.deleteMany({});
    return { count: result.count };
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    // 删父会话时一并删子会话，避免 parentSessionId 断链后「删不干净」
    const children = await this.prisma.chatSession.findMany({
      where: { parentSessionId: id },
      select: { id: true },
    });
    // 先停所有运行中的 Agent 流 / 清理 StreamHub 内存状态，否则删除 DB 记录后
    // zombie stream 仍在后台跑、消耗 LLM token，且 cleanupTimer 触发时 runs.delete 找不到对应条目
    try {
      const { getStreamHub } = await import("../sessionStreamHub.js");
      const hub = getStreamHub();
      const warnClear = (sid: string) => (err: unknown) => {
        console.warn(`[session.delete] hub.clear 失败 session=${sid}:`, err instanceof Error ? err.message : err);
      };
      for (const child of children) {
        hub?.stop(child.id);
        await hub?.clear(child.id).catch(warnClear(child.id));
      }
      hub?.stop(id);
      await hub?.clear(id).catch(warnClear(id));
    } catch {
      /* StreamHub 未初始化，忽略 */
    }
    const warnCascade = (label: string, sid: string) => (err: unknown) => {
      console.warn(`[session.delete] ${label} 失败 session=${sid}:`, err instanceof Error ? err.message : err);
    };
    for (const child of children) {
      await this.prisma.task.deleteMany({ where: { sessionId: child.id } }).catch(warnCascade("task", child.id));
      await this.prisma.sessionStreamEvent
        .deleteMany({ where: { sessionId: child.id } })
        .catch(warnCascade("streamEvent", child.id));
      await super.delete(child.id);
    }
    await this.prisma.task.deleteMany({ where: { sessionId: id } }).catch(warnCascade("task", id));
    await this.prisma.sessionStreamEvent
      .deleteMany({ where: { sessionId: id } })
      .catch(warnCascade("streamEvent", id));
    return super.delete(id);
  }

  protected override getCreateNextSteps(entity: SessionEntity): NextStep[] {
    return [{ action: "进入会话发送消息", procedure: "message.create", input: { sessionId: entity.id }, reason: "新会话已创建，可开始对话。" }];
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, title: existing.title };
  }
}
