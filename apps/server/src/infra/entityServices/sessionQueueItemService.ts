/**
 * SessionQueueItem 会话发送队列 Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateSessionQueueItemInput,
  UpdateSessionQueueItemInput,
  ListSessionQueueItemsInput,
  OperationResult,
} from "@knowpilot/shared";
import { BaseService } from "../../services.js";
import { success, failureFromError } from "../../trpc/result.js";

/**
 * W14 幂等防线：superior 镜像（AgentMessage → 会话发送队列）投递前的对账阈值。
 * 滞留 pending 超过该时长的 AgentMessage 视为「疑似已被其它管道投递过」，
 * 镜像入队前先查目标会话是否已有同内容消息。
 */
const SUPERIOR_MIRROR_STALE_MS = 5 * 60 * 1000;

export interface SessionQueueItemEntity {
  id: string;
  sessionId: string;
  kind: string;
  content: string;
  source: string;
  sourceName: string | null;
  agentMessageId: string | null;
  order: number;
  attachments: any;
  skillId: string | null;
  skillPrompt: string | null;
  claimedAt: Date | null;
  createdAt: Date;
}

/**
 * B2：软认领超龄阈值。
 * 长工具/spawn 流式常 >30s；过短会把「已起流未 finalize」项 release 回待发 → 刷新后幽灵排队。
 * 超龄时若已有同 content 的 user ChatMessage，必须 finalize 删行，禁止 release。
 */
export const SESSION_QUEUE_CLAIM_STALE_MS = 15 * 60_000;

export class SessionQueueItemService extends BaseService<
  CreateSessionQueueItemInput,
  UpdateSessionQueueItemInput,
  ListSessionQueueItemsInput,
  SessionQueueItemEntity
> {
  readonly entityName = "sessionQueueItem";
  protected get delegate() { return this.prisma.sessionQueueItem; }
  protected formatEntity(raw: any): SessionQueueItemEntity { return raw; }
  protected buildListWhere(input: ListSessionQueueItemsInput): any { return { sessionId: input.sessionId }; }
  protected buildCreateData(input: CreateSessionQueueItemInput): any {
    return {
      sessionId: input.sessionId,
      kind: input.kind,
      content: input.content,
      source: input.source,
      sourceName: input.sourceName ?? null,
      agentMessageId: input.agentMessageId ?? null,
      attachments: input.attachments ?? null,
      skillId: input.skillId ?? null,
      skillPrompt: input.skillPrompt ?? null,
    };
  }
  protected buildUpdateData(input: UpdateSessionQueueItemInput): any {
    const { id: _id, ...data } = input;
    return data;
  }
  protected override get defaultOrderBy(): string { return "order"; }
  protected override get defaultOrder(): "asc" | "desc" { return "asc"; }

  /** 推送 session_queue_update：创建/消费/删除/重排后让打开中的会话实时合并队列（不依赖刷新） */
  private async pushQueueUpdate(sessionId: string, kind: string): Promise<void> {
    try {
      const { getStreamHub } = await import("../sessionStreamHub.js");
      getStreamHub()?.pushExternalEvent(sessionId, {
        type: "session_queue_update",
        sessionId,
        kind,
      });
    } catch (err) {
      // hub 未初始化时忽略（单测 / 启动早期）；其它失败可观测
      console.warn(
        "[sessionQueueItem] pushQueueUpdate 失败:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** 创建时自动赋 order = 当前最大 order + 10；superior 幂等（同 agentMessageId 不重复） */
  override async create(input: CreateSessionQueueItemInput): Promise<OperationResult<SessionQueueItemEntity>> {
    const start = Date.now();
    try {
      if (input.kind === "superior" && input.agentMessageId) {
        const existing = await this.prisma.sessionQueueItem.findFirst({
          where: { sessionId: input.sessionId, agentMessageId: input.agentMessageId },
        });
        if (existing) {
          const entity = this.formatEntity(existing);
          // 幂等命中仍广播：晚订阅 / 首包空水合的前端可借此合并
          await this.pushQueueUpdate(entity.sessionId, entity.kind);
          return success({
            data: entity,
            operation: "create",
            entity: this.entityName,
            durationMs: Date.now() - start,
          });
        }

        // W14 幂等防线：投递前先对账，命中则只回写状态、不再镜像注入（防重复投递）。
        // 返回 success 但无 data——前端各调用方（mirror / enqueue / runStream 迁移补写）
        // 对缺失 id 均有兜底（跳过入队 / 不补 dbId），不会当成错误。
        if (await this.shouldSkipSuperiorMirror(input)) {
          return success({
            operation: "create",
            entity: this.entityName,
            durationMs: Date.now() - start,
          });
        }
      }

      // B7：maxOrder + create 同事务串行化；@@unique([sessionId, agentMessageId]) 兜底并发双建
      const raw = await this.prisma.$transaction(async (tx) => {
        const maxOrder = await tx.sessionQueueItem.aggregate({
          where: { sessionId: input.sessionId },
          _max: { order: true },
        });
        const order = (maxOrder._max.order ?? -10) + 10;
        return tx.sessionQueueItem.create({
          data: { ...this.buildCreateData(input), order },
        });
      });
      const entity = this.formatEntity(raw);
      await this.afterCreate(entity, input);
      await this.pushQueueUpdate(entity.sessionId, entity.kind);
      return success({
        data: entity,
        operation: "create",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      // B7：唯一约束冲突 → 幂等返回已有行（服务端 busy + 前端镜像并发）
      const code = (error as { code?: string })?.code;
      if (code === "P2002" && input.kind === "superior" && input.agentMessageId) {
        const existing = await this.prisma.sessionQueueItem.findFirst({
          where: { sessionId: input.sessionId, agentMessageId: input.agentMessageId },
        });
        if (existing) {
          const entity = this.formatEntity(existing);
          await this.pushQueueUpdate(entity.sessionId, entity.kind);
          return success({
            data: entity,
            operation: "create",
            entity: this.entityName,
            durationMs: Date.now() - start,
          });
        }
      }
      return failureFromError(error, "create", this.entityName, `${this.entityName.toUpperCase()}_CREATE_FAILED`);
    }
  }

  /**
   * W14 幂等防线：AgentMessage 镜像入会话队列前的对账。返回 true = 跳过本次镜像。
   * - 已 delivered/consumed：Task 管道已认领投递过该消息（report_back 旁路邮箱），
   *   再镜像就是重复注入，直接跳过（账已记过，无需回写）。
   * - 滞留 pending 超 SUPERIOR_MIRROR_STALE_MS 且目标会话已有同 content 消息：
   *   只把 AgentMessage 回写 consumed，不再注入（taskRef 缺失时按内容兜底对账）。
   */
  private async shouldSkipSuperiorMirror(input: CreateSessionQueueItemInput): Promise<boolean> {
    if (!input.agentMessageId) return false;
    const agentMsg = await this.prisma.agentMessage.findUnique({
      where: { id: input.agentMessageId },
      select: { id: true, status: true, content: true, createdAt: true },
    });
    if (!agentMsg) return false;
    if (agentMsg.status !== "pending") return true;
    if (Date.now() - agentMsg.createdAt.getTime() <= SUPERIOR_MIRROR_STALE_MS) return false;
    const dup = await this.prisma.chatMessage.findFirst({
      where: { sessionId: input.sessionId, content: agentMsg.content },
      select: { id: true },
    });
    if (!dup) return false;
    // W16a-1：条件写在 where 里（而非先读后写）——仅 pending → consumed 直跳时兜底补 deliveredAt，
    // 并发竞态下已被 CLAIM 置 delivered 的真账 deliveredAt 不会被本回写覆写。
    await this.prisma.agentMessage
      .updateMany({
        where: { id: agentMsg.id, status: "pending" },
        data: { status: "consumed", deliveredAt: new Date() },
      })
      .catch((err) => {
        console.warn(
          `[sessionQueueItem] superior mirror 滞留回写失败 id=${agentMsg.id}:`,
          err instanceof Error ? err.message : err,
        );
      });
    return true;
  }

  /** 按 session 列出未认领队列项（按 order 升序）；已软认领项对 UI/drain 不可见 */
  async listBySession(sessionId: string): Promise<SessionQueueItemEntity[]> {
    const rows = await this.prisma.sessionQueueItem.findMany({
      where: { sessionId, claimedAt: null },
      orderBy: { order: "asc" },
    });
    // 已落库为 ChatMessage 的 user 项不再暴露（防 release/竞态后刷新进「待发」）
    const userRows = rows.filter((r) => r.kind === "user" || r.kind === "child_notify");
    if (userRows.length === 0) return rows.map((r) => this.formatEntity(r));
    const delivered = await this.prisma.chatMessage.findMany({
      where: {
        sessionId,
        role: "user",
        content: { in: [...new Set(userRows.map((r) => r.content))] },
      },
      select: { content: true },
    });
    if (delivered.length === 0) return rows.map((r) => this.formatEntity(r));
    const deliveredSet = new Set(delivered.map((d) => d.content));
    const orphanIds = userRows.filter((r) => deliveredSet.has(r.content)).map((r) => r.id);
    if (orphanIds.length > 0) {
      // 异步清幽灵行：不阻塞 list；失败留给 reconciler
      this.prisma.sessionQueueItem
        .deleteMany({ where: { id: { in: orphanIds }, claimedAt: null } })
        .catch((err) => {
          console.warn(
            "[sessionQueueItem.list] 清幽灵行失败:",
            err instanceof Error ? err.message : err,
          );
        });
    }
    return rows
      .filter((r) => !(r.kind === "user" || r.kind === "child_notify") || !deliveredSet.has(r.content))
      .map((r) => this.formatEntity(r));
  }

  /**
   * resume / 恢复路径：仅当队首是 `kind=user` 且 `source=ask_user` 时软认领并返回内容。
   * 不越过 superior / 其它 user 项（保 FIFO）；认领失败（并发）返回 null。
   */
  async claimHeadAskUserOrphan(
    sessionId: string,
  ): Promise<{ id: string; content: string } | null> {
    const items = await this.listBySession(sessionId);
    const head = items[0];
    if (!head || head.kind !== "user" || head.source !== "ask_user") return null;
    const { claimed } = await this.consume(head.id);
    if (!claimed) return null;
    return { id: head.id, content: head.content };
  }

  /**
   * B2 软认领：条件写置 claimedAt（不再删行）。
   * 并发双 consume 落选方 claimed:false；行对 listBySession 不可见，待 ChatMessage 落地后 finalize 删行。
   */
  async consume(id: string): Promise<{ success: boolean; claimed: boolean }> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item) {
      return { success: true, claimed: false };
    }
    if (item.claimedAt) {
      return { success: true, claimed: false };
    }

    const claimed = await this.prisma.sessionQueueItem.updateMany({
      where: { id, claimedAt: null },
      data: { claimedAt: new Date() },
    });
    if (claimed.count > 0) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return { success: true, claimed: claimed.count > 0 };
  }

  /**
   * B2 落地确认：ChatMessage 已写入后删行 + 标记关联 AgentMessage consumed。
   * 幂等——行已删 / 未认领均 success；对外不暴露中间态。
   */
  async finalize(id: string): Promise<{ success: boolean; finalized: boolean }> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item) {
      return { success: true, finalized: false };
    }

    const finalized = await this.prisma.$transaction(async (tx) => {
      const del = await tx.sessionQueueItem.deleteMany({ where: { id, claimedAt: { not: null } } });
      if (del.count === 0) return false;
      if (item.kind === "superior" && item.agentMessageId) {
        // W16a-1：delivered → consumed 不动 deliveredAt；pending 直跳 consumed 兜底补齐。
        const fromDelivered = await tx.agentMessage.updateMany({
          where: { id: item.agentMessageId, status: "delivered" },
          data: { status: "consumed" },
        });
        if (fromDelivered.count === 0) {
          await tx.agentMessage.updateMany({
            where: { id: item.agentMessageId, status: "pending" },
            data: { status: "consumed", deliveredAt: new Date() },
          });
        }
      }
      return true;
    });
    if (finalized) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return { success: true, finalized };
  }

  /**
   * B2 启动/周期恢复：扫 claimedAt 超龄且未 finalize 的项。
   * - 已有同 content 的 user ChatMessage → finalize 删行（流式中途绝不可 release 回待发）
   * - 否则重置 claimedAt=null 供重投（崩溃窗口可恢复）
   */
  async releaseStaleClaims(staleMs = SESSION_QUEUE_CLAIM_STALE_MS): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(0, staleMs));
    const stale = await this.prisma.sessionQueueItem.findMany({
      where: { claimedAt: { not: null, lt: cutoff } },
    });
    if (stale.length === 0) return 0;
    let touched = 0;
    const sessionIds = new Set<string>();
    for (const item of stale) {
      const delivered =
        item.kind === "user" || item.kind === "child_notify"
          ? await this.prisma.chatMessage.findFirst({
              where: { sessionId: item.sessionId, role: "user", content: item.content },
              select: { id: true },
            })
          : null;
      if (delivered) {
        const fin = await this.finalize(item.id);
        if (fin.finalized) {
          touched += 1;
          sessionIds.add(item.sessionId);
        }
        continue;
      }
      const r = await this.prisma.sessionQueueItem.updateMany({
        where: { id: item.id, claimedAt: { not: null, lt: cutoff } },
        data: { claimedAt: null },
      });
      if (r.count > 0) {
        touched += 1;
        sessionIds.add(item.sessionId);
      }
    }
    for (const sessionId of sessionIds) {
      await this.pushQueueUpdate(sessionId, "user");
    }
    return touched;
  }

  /** 单条软认领回滚（busy/409 后重投）；成功则推 session_queue_update */
  async unclaim(id: string): Promise<boolean> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    if (!item?.claimedAt) return false;
    const r = await this.prisma.sessionQueueItem.updateMany({
      where: { id, claimedAt: { not: null } },
      data: { claimedAt: null },
    });
    if (r.count > 0) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
      return true;
    }
    return false;
  }

  /**
   * run 收尾：处理本会话未 finalize 的软认领。
   * - 认领后已有同 content 的 user ChatMessage → finalize 删行（防重复投递）
   * - 否则重置 claimedAt，供下一轮 drain（修 busy/409 认领后卡死）
   */
  async reconcileClaimsAfterRun(sessionId: string): Promise<number> {
    const claimed = await this.prisma.sessionQueueItem.findMany({
      where: { sessionId, claimedAt: { not: null } },
      orderBy: { order: "asc" },
    });
    if (claimed.length === 0) return 0;
    let touched = 0;
    for (const item of claimed) {
      const delivered = await this.prisma.chatMessage.findFirst({
        where: {
          sessionId,
          role: "user",
          content: item.content,
          createdAt: { gte: item.claimedAt! },
        },
        select: { id: true },
      });
      if (delivered) {
        const fin = await this.finalize(item.id);
        if (fin.finalized) touched += 1;
      } else {
        const r = await this.prisma.sessionQueueItem.updateMany({
          where: { id: item.id, claimedAt: { not: null } },
          data: { claimedAt: null },
        });
        if (r.count > 0) touched += 1;
      }
    }
    if (touched > 0) {
      await this.pushQueueUpdate(sessionId, "user");
    }
    return touched;
  }

  /** 批量重排序：按 orderedIds 顺序依次赋 order = index * 10 */
  async reorder(sessionId: string, orderedIds: string[]): Promise<{ success: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.sessionQueueItem.updateMany({
          where: { id: orderedIds[i], sessionId },
          data: { order: i * 10 },
        });
      }
    });
    await this.pushQueueUpdate(sessionId, "reorder");
    return { success: true };
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const item = await this.prisma.sessionQueueItem.findUnique({ where: { id } });
    const result = await super.delete(id);
    if (result.success && item) {
      await this.pushQueueUpdate(item.sessionId, item.kind);
    }
    return result;
  }
}
