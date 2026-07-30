/**
 * Approval 审批 Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateApprovalInput,
  UpdateApprovalInput,
  ListApprovalsInput,
} from "@knowpilot/shared";
import { BaseService } from "../../services.js";
import { notifyApprovalResolved } from "../approvalGate.js";
import { deriveDecisionScope } from "../approvalScope.js";

export class ApprovalService extends BaseService<CreateApprovalInput, UpdateApprovalInput, ListApprovalsInput, any> {
  readonly entityName = "approval";
  protected get delegate() { return this.prisma.approval; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListApprovalsInput) {
    const where: any = {};
    if (input.status) where.status = input.status;
    return where;
  }
  protected buildCreateData(input: CreateApprovalInput) {
    // W3：服务端派生 decisionScope（LLM/客户端不可传业务语义；已有则保留）
    const args =
      input.args && typeof input.args === "object" && !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : {};
    const decisionScope =
      typeof input.decisionScope === "string" && input.decisionScope.trim()
        ? input.decisionScope.trim()
        : deriveDecisionScope(input.toolName, args);
    return { ...input, decisionScope };
  }
  protected buildUpdateData(input: UpdateApprovalInput) {
    const { id: _id, ...data } = input;
    // 审批决策审计：进入决策终态（approved/rejected）时统一盖决策者与时间戳。
    // 当前单用户本地场景固定 "local-user"（AUTH_MODE=password 亦为同一本地账户）。
    if (input.status === "approved" || input.status === "rejected") {
      return { ...data, decidedBy: "local-user", decidedAt: new Date() };
    }
    return data;
  }

  /**
   * W11：人工拒绝是审批决策点——发 approval_resolved 显式事件，
   * 唤醒挂在该审批上的 run（awaiting_human → llm，注入拒绝消息让 LLM 收尾）。
   * approved 不在此发：执行完成（executeApprovedOperation）才发，携带执行结果。
   */
  protected override async afterCreate(entity: any, input: CreateApprovalInput): Promise<void> {
    await super.afterCreate(entity, input);
    const { notifyAllMainSessionsUi } = await import("../uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "approval_updated",
      approvalId: entity.id,
      status: entity.status,
    });
  }

  protected override async afterUpdate(entity: any, existing: any, input: UpdateApprovalInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    if (input.status === "rejected") {
      notifyApprovalResolved(entity.id, {
        outcome: "rejected",
        approvalId: entity.id,
        toolName: entity.toolName ?? "unknown",
      });
    }
    const { notifyAllMainSessionsUi } = await import("../uiStateNotify.js");
    await notifyAllMainSessionsUi(this.prisma, {
      type: "approval_updated",
      approvalId: entity.id,
      status: entity.status,
    });
  }
}
