/**
 * agent Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateAgentInput,
  UpdateAgentInput,
  ListAgentsInput,
  AgentRunInput,
  AgentChatInput,
  OperationResult,
  NextStep,
} from "@knowpilot/shared";
import { materializeAgentTools } from "@knowpilot/shared";
import { TRPCError } from "@trpc/server";
import matter from "gray-matter";
import {
  FileSyncService,
  ServiceValidationError,
  type PaginatedResult,
} from "../../services.js";
import { success, failure, failureFromError } from "../../trpc/result.js";
import { upsertFtsRow, deleteFtsRow } from "../ftsIndex.js";

export interface AgentEntity {
  id: string;
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string;
  tools: string[];
  // Swarm 层级
  tier: "super" | "manager" | "sub";
  workspaceId: string | null;
  parentId: string | null;
  heartbeatModel: string | null;
  heartbeat: any;
  status: string;
  source: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AgentService extends FileSyncService<CreateAgentInput, UpdateAgentInput, ListAgentsInput, AgentEntity> {
  readonly entityName = "agent";
  readonly contentDirName = "agents";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.agent; }

  protected formatEntity(raw: any): AgentEntity {
    const { ...rest } = raw;
    return {
      ...rest,
      tools: raw.tools ? raw.tools.split(",").filter(Boolean).map((t: string) => t.trim()) : [],
    };
  }

  // R19：列表裁剪——排除 systemPrompt（KB 级，Chat 用 agent.getById 取）、apiKey（安全）、
  // sourceSlug/sourceMtime（同步用，列表不需要）。详情走 getById 取全量。
  protected override getListSelect(): any {
    return {
      id: true, name: true, autoName: true, description: true, model: true, tools: true,
      tier: true, workspaceId: true, parentId: true, heartbeatModel: true,
      heartbeat: true, heartbeatSuspendedAt: true, status: true, source: true,
      deletedAt: true, deletedBy: true, createdAt: true, updatedAt: true,
    };
  }

  protected buildListWhere(input: ListAgentsInput): any {
    const where: any = {};
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    // Swarm 过滤
    if (input.tier) where.tier = input.tier;
    if (input.workspaceId) where.workspaceId = input.workspaceId;
    if (input.parentId) where.parentId = input.parentId;
    if (input.status) where.status = input.status;
    else where.status = { not: "deleted" }; // 默认不返回 tombstone
    return where;
  }

  protected override getOrderBy(input: ListAgentsInput): any {
    // tier DESC 使 "super" 排最前（字典序 super > sub > manager），
    // 前端页内再按 super>manager>sub 精确排序；避免超级 Agent 沉到后面分页
    if ((input as any).orderBy) return super.getOrderBy(input);
    return [{ tier: "desc" }, { createdAt: "desc" }];
  }

  protected buildCreateData(input: CreateAgentInput): any {
    const tools = materializeAgentTools(input.tools);
    return {
      name: input.name,
      description: input.description,
      model: input.model,
      systemPrompt: input.systemPrompt,
      tools: tools.join(","),
      // Swarm 字段（tier 默认 sub）
      tier: input.tier ?? "sub",
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.heartbeatModel !== undefined ? { heartbeatModel: input.heartbeatModel } : {}),
      ...(input.heartbeat !== undefined ? { heartbeat: input.heartbeat } : {}),
    };
  }

  protected buildUpdateData(input: UpdateAgentInput): any {
    const { id: _id, tools, name, tier, workspaceId, parentId, source, heartbeatModel, heartbeat, status, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name;
    if (tools !== undefined) updateData.tools = materializeAgentTools(tools).join(",");
    if (tier !== undefined) updateData.tier = tier;
    if (workspaceId !== undefined) updateData.workspaceId = workspaceId;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (source !== undefined) updateData.source = source;
    if (heartbeatModel !== undefined) updateData.heartbeatModel = heartbeatModel;
    if (heartbeat !== undefined) updateData.heartbeat = heartbeat;
    if (status !== undefined) updateData.status = status;
    return updateData;
  }

  protected serializeToFile(entity: AgentEntity): string {
    // gray-matter/js-yaml 统一序列化：引号/反斜杠/换行由 YAML 库正确转义，杜绝手拼的往返损坏
    return matter.stringify(entity.systemPrompt ?? "", {
      name: entity.name,
      description: entity.description ?? null,
      model: entity.model,
      tier: entity.tier,
      tools: entity.tools,
      source: entity.source ?? null,
    });
  }

  protected getFileSlug(entity: AgentEntity): string { return `${entity.name}-${entity.id.slice(-6)}`; }

  // P11：FTS 增量；每个 Agent 创建后立刻有一条空主会话（真实 sessionId，避免 Chat「无会话」空态）
  protected override async afterCreate(entity: AgentEntity, input: CreateAgentInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("agent", entity.id, entity.name, `${entity.description ?? ""}\n${entity.systemPrompt ?? ""}`);
    const { ensureMainSession } = await import("../ensureMainSession.js");
    await ensureMainSession(this.prisma, {
      agentId: entity.id,
      title: `${entity.name} 主会话`,
      model: entity.model,
    }).catch((err) => {
      console.warn(`[AgentService] ensureMainSession 失败 agentId=${entity.id}:`, err);
    });
    // A14：通知 heartbeatEngine / agentSchemaCache 等 agent 配置变更
    this.eventBus.emit("agent.created", entity);
    const { notifyAllMainSessionsUi } = await import("../uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "agent_list_changed",
      agentId: entity.id,
      reason: "create",
    });
  }
  protected override async afterUpdate(entity: AgentEntity, existing: any, input: UpdateAgentInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    // tombstone（status=deleted）必须出索引而非重插——否则已删 Agent 仍能被全局搜索命中
    if (entity.status === "deleted") {
      await this.removeFts("agent", entity.id);
    } else {
      await this.syncFts("agent", entity.id, entity.name, `${entity.description ?? ""}\n${entity.systemPrompt ?? ""}`);
    }
    this.eventBus.emit("agent.updated", entity);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("agent", existing.id);
    this.eventBus.emit("agent.deleted", existing);
    const { notifyAllMainSessionsUi } = await import("../uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "agent_list_changed",
      agentId: existing.id,
      reason: "delete",
    });
  }

  // 超级 Agent 全局唯一——创建时拦截。
  // name 不做唯一性校验：schema 注释「名称（可重复）」，swarm 允许重名（#37），id 才是全局唯一标识；
  // 也因此 tombstone 的名字天然可复用，无需在唯一性层过滤 status=deleted。
  protected override async validateCreate(input: CreateAgentInput): Promise<void> {
    if (input.tier === "super") {
      const existingSuper = await this.prisma.agent.findFirst({
        where: { tier: "super", status: { not: "deleted" } },
      });
      if (existingSuper) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "已存在超级 Agent，全局只允许一个。请编辑现有超级 Agent 而非创建新的。",
        });
      }
    }
  }

  protected override async validateUpdate(input: UpdateAgentInput, existing: any): Promise<void> {
    // name 允许重名（同 validateCreate），不做唯一性校验
    // Q1：超级 Agent 禁止降级 / 改 tier；禁止把其他 Agent 改成第二个 super
    if (existing.tier === "super" && input.tier !== undefined && input.tier !== "super") {
      throw new ServiceValidationError(
        failure({
          code: "SUPER_TIER_IMMUTABLE",
          message: "超级 Agent 的 tier 不可修改（禁止自降级）。",
          retryable: false,
          operation: "update",
          entity: this.entityName,
        }),
      );
    }
    if (input.tier === "super" && existing.tier !== "super") {
      throw new ServiceValidationError(
        failure({
          code: "SUPER_AGENT_UNIQUE",
          message: "不能将其他 Agent 提升为超级 Agent（全局唯一，由系统初始化创建）。",
          retryable: false,
          operation: "update",
          entity: this.entityName,
        }),
      );
    }
  }

  /**
   * W16d-2：心跳配置变更 = 人工修复信号 → consecutiveFailures 清零，
   * suspended 标记随后由 heartbeatEngine.refresh() 个体化摘除（计数清零是其唯一恢复条件）。
   * 判定字段：heartbeat.enabled/cron/goal + heartbeatModel（改模型常是修 LLM 配置）；
   * 仅「值确实变化」才清零——原样保存不算修复，不把 suspended 变成形式检查。
   */
  override async update(input: UpdateAgentInput): Promise<OperationResult<AgentEntity>> {
    if (input.heartbeat !== undefined || input.heartbeatModel !== undefined) {
      const existing = await this.delegate.findUnique({
        where: { id: input.id },
        select: { heartbeat: true, heartbeatModel: true },
      });
      if (existing) {
        const prev = (existing.heartbeat ?? null) as {
          enabled?: boolean;
          cron?: string;
          goal?: string;
        } | null;
        const next = input.heartbeat as { enabled?: boolean; cron?: string; goal?: string } | undefined;
        const heartbeatChanged =
          next !== undefined &&
          (next.enabled !== prev?.enabled || next.cron !== prev?.cron || next.goal !== prev?.goal);
        const modelChanged =
          input.heartbeatModel !== undefined && input.heartbeatModel !== existing.heartbeatModel;
        if ((heartbeatChanged || modelChanged) && (next ?? prev)) {
          const base = (next ?? prev) as NonNullable<UpdateAgentInput["heartbeat"]>;
          // W2：配置变更同时清零决策 terminal/退避态，供 refresh 摘除 suspended
          input = {
            ...input,
            heartbeat: {
              ...base,
              consecutiveFailures: 0,
              decision: {
                skipRemaining: 0,
                resetToken: "",
                lastMode: null,
                quietStreak: 0,
                lastSkipTicks: 0,
                lastGateNotifyAt: null,
                lastGateNotifyKey: null,
                terminalAt: null,
              },
            },
          };
        }
      }
    }
    return super.update(input);
  }

  /**
   * tombstone 删除（native agent_delete 的统一入口）。
   * 与 tRPC 硬删保持一致的最终效果：出 FTS、删配置文件、名字可复用（name 本无唯一约束）；
   * 区别在于保留 DB 行作审计（status=deleted + deletedAt/deletedBy）。
   * sourceSlug 同步清空：防止 cleanup 按 sourceSlug 误收审计行，也防止文件残留时 sync 把行复活。
   */
  async tombstone(id: string, opts?: { deletedBy?: string }): Promise<OperationResult<Record<string, unknown>>> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (!existing) return this.buildNotFoundFailure("删除", id, 0);
    if (existing.tier === "super") {
      return failure({
        code: "SUPER_AGENT_NOT_DELETABLE",
        message: "超级 Agent 不可删除。它是 Swarm 体系的核心，删除将导致整个系统瘫痪。",
        details: { id, tier: "super" },
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    // 删配置文件：优先 sourceSlug（文件源 Agent 的真实落点），回退实体推导 slug；
    // required=false——文件可能本就不存在（运行时创建从未落盘），删不掉不阻塞 tombstone
    const slug = existing.sourceSlug ?? this.getExistingFileSlug(existing);
    if (slug) this.deleteFileBySlug(slug, { required: false });
    await this.delegate.update({
      where: { id },
      data: {
        status: "deleted",
        deletedAt: new Date(),
        deletedBy: opts?.deletedBy ?? null,
        sourceSlug: null,
        sourceMtime: null,
      },
    });
    await this.removeFts("agent", id);
    this.eventBus.emit("agent.deleted", existing);
    const { notifyAllMainSessionsUi } = await import("../uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "agent_list_changed",
      agentId: id,
      reason: "delete",
    });
    return success({
      data: this.buildDeleteSummary(existing),
      operation: "delete",
      entity: this.entityName,
    });
  }

  // 超级 Agent 不可删除——系统核心，删除会导致 Swarm 体系崩溃
  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (existing?.tier === "super") {
      return failure({
        code: "SUPER_AGENT_NOT_DELETABLE",
        message: "超级 Agent 不可删除。它是 Swarm 体系的核心，删除将导致整个系统瘫痪。",
        details: { id, tier: "super" },
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    return super.delete(id);
  }

  // A6：批量删除，保留文件清理 + FTS 移除语义。超级 Agent 自动跳过。
  async bulkDelete(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    const existing = await this.prisma.agent.findMany({ where: { id: { in: ids } } });
    // 超级 Agent 不可删除，从删除列表中排除
    const deletableAgents = existing.filter((a: any) => a.tier !== "super");
    const superAgents = existing.filter((a: any) => a.tier === "super");
    for (const sa of superAgents) {
      errors.push(`${sa.id}: 超级 Agent 不可删除`);
    }
    const existingIds = new Set(deletableAgents.map((e: any) => e.id));
    const result = await this.prisma.agent.deleteMany({ where: { id: { in: [...existingIds] } } });
    for (const raw of deletableAgents) {
      try {
        this.deleteFile(this.formatEntity(raw));
      } catch (e) {
        // #6：文件删除失败不阻塞，但记录到 stderr 便于发现 DB 与文件不一致
        console.error(`[Agent.bulkDelete] 删除配置文件失败 agent=${raw.id}:`, e instanceof Error ? e.message : e);
      }
      await this.removeFts("agent", raw.id);
    }
    for (const id of ids) {
      if (!existingIds.has(id) && !superAgents.some((sa: any) => sa.id === id)) errors.push(`${id}: 不存在`);
    }
    return { deleted: result.count, errors };
  }

  // name 不再 @unique（swarm 允许重名，#37），用 id 做全局唯一标识
  // sourceSlug 仍 @unique，由 getFileSlug 生成唯一 slug
}

/** SkillService 已拆至 infra/entityServices/skillService.ts */

/** McpService 已拆至 infra/entityServices/mcpService.ts */

/** MemoryService 已拆至 infra/entityServices/memoryService.ts */

