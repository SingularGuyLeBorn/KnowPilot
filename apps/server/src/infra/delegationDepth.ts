/**
 * B5：委托深度服务端物化（叶子模块，无环）
 *
 * depth = 发送方最近入站 AgentMessage.depth + 1；无入站则 1。
 * 与 W16a taskRef 同手法——不接受 LLM / 调用方入参。
 */

import type { PrismaClient } from "@prisma/client";

export async function resolveServerDelegationDepth(
  prisma: PrismaClient,
  fromAgentId: string,
): Promise<number> {
  if (!fromAgentId) return 1;
  const lastInbound = await prisma.agentMessage.findFirst({
    where: { toAgentId: fromAgentId },
    orderBy: { createdAt: "desc" },
    select: { depth: true },
  });
  return (lastInbound?.depth ?? 0) + 1;
}
