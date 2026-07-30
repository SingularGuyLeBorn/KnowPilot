/**
 * ChatMessage Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateMessageInput,
  UpdateMessageInput,
  ListMessagesInput,
  OperationResult,
} from "@knowpilot/shared";
import { BaseService, ServiceValidationError, failureFromPrismaUnique } from "../../services.js";
import { success, failureFromError } from "../../trpc/result.js";

/** ChatMessage 聊天消息 */
export interface MessageEntity {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  parentId?: string | null;
  label?: string | null;
  kind?: string | null;
  attachments: any;
  toolCalls: any;
  toolResults: any;
  tokenUsage: any;
  finishReason?: string | null;
  source?: string;
  createdAt: Date;
}

function messageUpsertPayload(entity: MessageEntity) {
  return {
    id: entity.id,
    role: entity.role,
    content: entity.content,
    parentId: entity.parentId ?? null,
    label: entity.label ?? null,
    kind: entity.kind ?? null,
    toolCalls: entity.toolCalls ?? undefined,
    toolResults: entity.toolResults ?? undefined,
    tokenUsage: entity.tokenUsage ?? undefined,
    attachments: entity.attachments ?? undefined,
    source: entity.source ?? null,
    createdAt: entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
  };
}

export class MessageService extends BaseService<CreateMessageInput, UpdateMessageInput, ListMessagesInput, MessageEntity> {
  readonly entityName = "message";
  protected get delegate() { return this.prisma.chatMessage; }
  protected formatEntity(raw: any): MessageEntity { return raw; }
  protected buildListWhere(input: ListMessagesInput): any { return { sessionId: input.sessionId }; }
  protected buildCreateData(input: CreateMessageInput): any { return input; }
  protected buildUpdateData(input: UpdateMessageInput): any {
    const { id: _id, ...data } = input;
    return data;
  }
  protected override get defaultOrderBy(): string { return "createdAt"; }
  protected override get defaultOrder(): "asc" | "desc" { return "asc"; }

  /**
   * W1：消息 create + activeLeafId 推进必须同事务（appendChatMessage）。
   * 禁止走裸 delegate.create，否则会话树断链。
   */
  override async create(input: CreateMessageInput): Promise<OperationResult<MessageEntity>> {
    const start = Date.now();
    try {
      await this.validateCreate(input);
      const { appendChatMessage } = await import("../chatTree.js");
      const raw = await appendChatMessage(this.prisma, {
        id: input.id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        attachments: input.attachments,
        toolCalls: input.toolCalls,
        toolResults: input.toolResults,
        tokenUsage: input.tokenUsage,
        finishReason: input.finishReason,
        source: input.source,
      });
      const entity = this.formatEntity(raw);
      await this.afterCreate(entity, input);
      return success({
        data: entity,
        state: await this.getState(),
        nextSteps: this.getCreateNextSteps(entity),
        operation: "create",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      const uniqueConflict = failureFromPrismaUnique(error, "创建", this.entityName);
      if (uniqueConflict) return uniqueConflict;
      return failureFromError(error, "create", this.entityName, `${this.entityName.toUpperCase()}_CREATE_FAILED`);
    }
  }

  protected override async afterCreate(entity: MessageEntity, input: CreateMessageInput): Promise<void> {
    // updatedAt / activeLeafId 已由 appendChatMessage 同事务推进；此处只广播。
    await super.afterCreate(entity, input);
    try {
      const { getStreamHub } = await import("../sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(entity.sessionId, {
        type: "message_upserted",
        sessionId: entity.sessionId,
        message: messageUpsertPayload(entity),
      });
    } catch {
      /* StreamHub 未初始化或会话已清理，忽略 */
    }
  }

  /**
   * 手工编辑 content 时同步 assistant versionMeta（激活版本），
   * 调用方未显式传 toolResults 才介入（switchVersion 自带 toolResults）。
   */
  override async update(input: UpdateMessageInput): Promise<OperationResult<MessageEntity>> {
    let next = input;
    if (typeof input.content === "string" && input.toolResults === undefined) {
      const existing = await this.delegate.findUnique({ where: { id: input.id } });
      if (existing?.role === "assistant") {
        const { syncAssistantActiveContent } = await import("../messageVersions.js");
        next = {
          ...input,
          toolResults: syncAssistantActiveContent(existing, input.content),
        };
      }
    }
    return super.update(next);
  }

  protected override async afterUpdate(entity: MessageEntity, _existing: any, _input: UpdateMessageInput): Promise<void> {
    await super.afterUpdate(entity, _existing, _input);
    try {
      const { getStreamHub } = await import("../sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(entity.sessionId, {
        type: "message_upserted",
        sessionId: entity.sessionId,
        message: messageUpsertPayload(entity),
      });
    } catch {
      /* ignore */
    }
  }

  async setLabel(input: { messageId: string; label: string | null }): Promise<MessageEntity> {
    const { setMessageLabel } = await import("../chatTree.js");
    const updated = await setMessageLabel(this.prisma, input);
    const entity = this.formatEntity(updated);
    await this.afterUpdate(entity, updated, { id: input.messageId } as UpdateMessageInput);
    return entity;
  }

  /** 树语义删除：子节点重挂 + activeLeafId 归位（禁止裸 delegate.delete） */
  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const start = Date.now();
    try {
      const existing = await this.delegate.findUnique({ where: { id } });
      if (!existing) return this.buildNotFoundFailure("删除", id, Date.now() - start);
      const { removeChatMessage } = await import("../chatTree.js");
      await removeChatMessage(this.prisma, id);
      await this.afterDelete(existing);
      return success({
        data: this.buildDeleteSummary(existing),
        state: await this.getState(),
        nextSteps: this.getDeleteNextSteps(),
        operation: "delete",
        entity: this.entityName,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      if (error instanceof ServiceValidationError) return error.result;
      return failureFromError(error, "delete", this.entityName, `${this.entityName.toUpperCase()}_DELETE_FAILED`);
    }
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    const sessionId: string | undefined = existing?.sessionId;
    const messageId: string | undefined = existing?.id;
    if (!sessionId || !messageId) return;
    try {
      const { getStreamHub } = await import("../sessionStreamHub.js");
      const hub = getStreamHub();
      hub?.pushExternalEvent(sessionId, {
        type: "message_deleted",
        sessionId,
        messageId,
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * 构建 LLM 上下文专用历史（仅活跃路径，排除 branch_summary）：
   * - 有 since（通常 = contextCompactedAt）：取该时刻起的最近 limit 条
   * - 无 since：取活跃路径最近 limit 条
   */
  async listForLlmContext(input: {
    sessionId: string;
    since?: Date | string | null;
    limit?: number;
  }): Promise<MessageEntity[]> {
    const { resolveActivePath, BRANCH_SUMMARY_KIND, healBrokenChatTree } = await import(
      "../chatTree.js"
    );
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const since = input.since ? new Date(input.since) : null;
    await healBrokenChatTree(this.prisma, input.sessionId).catch((err) => {
      console.warn(
        `[message.listForLlmContext] healBrokenChatTree 失败 session=${input.sessionId}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    const session = await this.prisma.chatSession.findUnique({
      where: { id: input.sessionId },
      select: { activeLeafId: true },
    });
    const all = await this.prisma.chatMessage.findMany({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: "asc" },
    });
    let path = resolveActivePath(all, session?.activeLeafId).filter(
      (m) => m.kind !== BRANCH_SUMMARY_KIND,
    );
    if (since && !Number.isNaN(since.getTime())) {
      path = path.filter((m) => m.createdAt >= since);
    }
    if (path.length > limit) path = path.slice(-limit);
    return path.map((i: any) => this.formatEntity(i));
  }

  /**
   * Chat 专用 cursor 无限查询（默认活跃路径 + 路径上挂的 branch_summary）。
   * tree:true 调试模式返回全树按 createdAt。
   */
  async listForChat(input: {
    sessionId: string;
    cursor?: string;
    limit?: number;
    tree?: boolean;
  }): Promise<{ items: MessageEntity[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    let ordered: any[];

    if (input.tree) {
      ordered = await this.prisma.chatMessage.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
      });
    } else {
      const { resolveActivePathWithSummaries, healBrokenChatTree } = await import(
        "../chatTree.js"
      );
      // 读路径自愈：全树悬空 parent / 幽灵 leaf 先修再取路径
      await healBrokenChatTree(this.prisma, input.sessionId).catch((err) => {
        console.warn(
          `[message.listForChat] healBrokenChatTree 失败 session=${input.sessionId}:`,
          err instanceof Error ? err.message : err,
        );
        return { healed: false, activeLeafId: null, repairedCount: 0 };
      });
      const session = await this.prisma.chatSession.findUnique({
        where: { id: input.sessionId },
        select: { activeLeafId: true },
      });
      const all = await this.prisma.chatMessage.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
      });
      ordered = resolveActivePathWithSummaries(all, session?.activeLeafId);
    }

    let window: any[];
    if (input.cursor) {
      const idx = ordered.findIndex((m) => m.id === input.cursor);
      if (idx <= 0) return { items: [] };
      const start = Math.max(0, idx - limit);
      window = ordered.slice(start, idx);
    } else {
      window = ordered.slice(-limit);
    }

    const formatted = window.map((i: any) => this.formatEntity(i));
    const nextCursor = formatted.length >= limit && ordered[0]?.id !== formatted[0]?.id
      ? formatted[0]?.id
      : formatted.length >= limit
        ? formatted[0]?.id
        : undefined;
    // 已到顶：本页覆盖到 ordered[0]
    const reachedTop = formatted.length > 0 && formatted[0]?.id === ordered[0]?.id;
    return { items: formatted, nextCursor: reachedTop ? undefined : nextCursor };
  }
}
