/**
 * Workspace 工作区 Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  ListWorkspacesInput,
  OperationResult,
} from "@knowpilot/shared";
import { BaseService, ServiceValidationError } from "../../services.js";
import { failure } from "../../trpc/result.js";

export class WorkspaceService extends BaseService<CreateWorkspaceInput, UpdateWorkspaceInput, ListWorkspacesInput, any> {
  readonly entityName = "workspace";
  protected get delegate() { return this.prisma.workspace; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListWorkspacesInput) {
    const where: any = {};
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    if (input.status) where.status = input.status;
    else where.status = { not: "deleted" }; // 默认不返回 tombstone
    return where;
  }
  protected buildCreateData(input: CreateWorkspaceInput) {
    const {
      autoCreateManager: _auto,
      withManager: _with,
      managerName: _mgrName,
      initialTask: _task,
      ...data
    } = input;
    return {
      ...data,
      status: "active",
      asyncSlotQuota: typeof input.asyncSlotQuota === "number" ? input.asyncSlotQuota : 2,
    };
  }
  protected buildUpdateData(input: UpdateWorkspaceInput) {
    const { id: _id, ...data } = input;
    return data;
  }
  protected override getOrderBy(input: ListWorkspacesInput): any {
    // 系统 Workspace 置顶，其余按创建时间倒序
    if ((input as any).orderBy) return super.getOrderBy(input);
    return [{ isSystem: "desc" }, { createdAt: "desc" }];
  }

  protected override async validateCreate(input: CreateWorkspaceInput): Promise<void> {
    await this.assertUnique("path", input.path, "创建");
  }
  protected override async validateUpdate(input: UpdateWorkspaceInput, existing: any): Promise<void> {
    if (existing.isSystem) {
      if (input.status && input.status !== "active") {
        throw new ServiceValidationError(
          failure({
            code: "SYSTEM_WORKSPACE_IMMUTABLE",
            message: "系统 Workspace 不可归档或删除",
            suggestion: "系统 Workspace 是 KnowPilot 运行所必需，无法修改其状态。",
            retryable: false,
            operation: "update",
            entity: this.entityName,
          }),
        );
      }
      if (input.path && input.path !== existing.path) {
        throw new ServiceValidationError(
          failure({
            code: "SYSTEM_WORKSPACE_IMMUTABLE",
            message: "系统 Workspace 路径不可修改",
            suggestion: "系统 Workspace 路径固定，无法变更。",
            retryable: false,
            operation: "update",
            entity: this.entityName,
          }),
        );
      }
    }
    if (input.path && input.path !== existing.path) await this.assertUnique("path", input.path, "更新", input.id);
  }

  override async delete(id: string): Promise<OperationResult<Record<string, unknown>>> {
    const existing = await this.delegate.findUnique({ where: { id } });
    if (existing?.isSystem) {
      return failure({
        code: "SYSTEM_WORKSPACE_NOT_DELETABLE",
        message: "系统 Workspace 不可删除",
        suggestion: "系统 Workspace 是 KnowPilot 运行所必需。",
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    const hasSuperAgent = await this.prisma.agent.findFirst({
      where: { workspaceId: id, tier: "super", status: { not: "deleted" } },
    });
    if (hasSuperAgent) {
      return failure({
        code: "WORKSPACE_HAS_SUPER_AGENT",
        message: "该 Workspace 包含超级 Agent，不可删除",
        suggestion: "请先迁移或删除该 Workspace 下的超级 Agent 后再注销 Workspace。",
        retryable: false,
        operation: "delete",
        entity: this.entityName,
      });
    }
    return super.delete(id);
  }
}
