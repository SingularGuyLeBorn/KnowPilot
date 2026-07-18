/**
 * ensureMainSession — 每个 Agent 恰好一条 isMainSession 主会话（幂等）。
 *
 * 叶子模块：仅依赖 Prisma，供 AgentService.afterCreate / agentFactory /
 * swarmInitializer / Chat 入口复用，禁止再散落多处 chatSession.create(isMainSession)。
 */

import type { PrismaClient, ChatSession } from "@prisma/client";

export type EnsureMainSessionResult = {
  session: ChatSession;
  /** true = 本次新建；false = 已存在 */
  created: boolean;
};

/**
 * 为 Agent 确保主会话存在。已存在则直接返回；否则创建空会话（无消息）。
 */
export async function ensureMainSession(
  prisma: PrismaClient,
  opts: { agentId: string; title: string; model: string },
): Promise<EnsureMainSessionResult> {
  const existing = await prisma.chatSession.findFirst({
    where: { agentId: opts.agentId, isMainSession: true, status: { not: "deleted" } },
  });
  if (existing) return { session: existing, created: false };

  const session = await prisma.chatSession.create({
    data: {
      title: opts.title,
      model: opts.model,
      agentId: opts.agentId,
      isMainSession: true,
      status: "active",
    },
  });
  return { session, created: true };
}
