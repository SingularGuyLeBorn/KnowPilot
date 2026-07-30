/**
 * tRPC 路由共用的审批守卫（从 router.ts 抽出，供 trpcRouters 叶子复用）。
 */

import type { ServiceContainer } from "../serviceContainer.js";
import { assertApprovalOrProceed } from "../approvalGate.js";

export async function withApprovalGuard(
  services: ServiceContainer,
  toolName: string,
  args: Record<string, unknown>,
  approvalId: string | undefined,
  execute: () => Promise<unknown>,
) {
  await assertApprovalOrProceed(services, toolName, args, approvalId);
  return execute();
}
