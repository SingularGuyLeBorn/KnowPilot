/**
 * openNewSession — 「新对话」按钮语义（幂等、原子判定）。
 *
 * 1. 当前 Agent 已有空 chat 会话且焦点在其上 → already_here（不切换）
 * 2. 已有空会话且焦点不在其上 → switched（切到该空会话，不新建）
 * 3. 无空会话 → created（新建一条空会话）
 *
 * 叶子模块：仅依赖 Prisma。
 */

import type { PrismaClient, ChatSession } from "@prisma/client";

export type OpenNewSessionAction = "already_here" | "switched" | "created";

export type OpenNewSessionResult = {
  session: ChatSession;
  action: OpenNewSessionAction;
};

const emptyChatWhere = (agentId: string) => ({
  agentId,
  kind: "chat" as const,
  status: { notIn: ["deleted", "archived"] as string[] },
  messages: { none: {} },
});

/**
 * 为 Agent 打开「新对话」：优先复用已有空会话，否则创建。
 */
export async function openNewSession(
  prisma: PrismaClient,
  opts: {
    agentId: string;
    focusedSessionId?: string | null;
    title: string;
    model: string;
  },
): Promise<OpenNewSessionResult> {
  if (opts.focusedSessionId) {
    const focusedEmpty = await prisma.chatSession.findFirst({
      where: {
        id: opts.focusedSessionId,
        ...emptyChatWhere(opts.agentId),
      },
    });
    if (focusedEmpty) {
      return { session: focusedEmpty, action: "already_here" };
    }
  }

  const existingEmpty = await prisma.chatSession.findFirst({
    where: emptyChatWhere(opts.agentId),
    orderBy: { updatedAt: "desc" },
  });
  if (existingEmpty) {
    return { session: existingEmpty, action: "switched" };
  }

  const session = await prisma.chatSession.create({
    data: {
      title: opts.title,
      model: opts.model,
      agentId: opts.agentId,
      kind: "chat",
      status: "active",
      isMainSession: false,
    },
  });
  return { session, action: "created" };
}
