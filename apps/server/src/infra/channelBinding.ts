/**
 * ChannelBinding — (channel, peerId[, chatId]) ↔ ChatSession 映射。
 * 本地优先：绑定存 SQLite；每条对端独占一个 kind=channel 会话（不占主会话）。
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import type { ImChannel } from "./messageGateway.js";
import { DEFAULT_LLM_MODEL } from "@knowpilot/shared";

export type ChannelBindingRow = {
  id: string;
  channel: string;
  peerId: string;
  chatId: string | null;
  sessionId: string;
  agentId: string;
  title: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function resolveDefaultAgentId(prisma: PrismaClient): Promise<{ id: string; model: string }> {
  const assistant = await prisma.agent.findFirst({
    where: {
      status: { not: "deleted" },
      OR: [{ sourceSlug: "assistant" }, { name: "assistant" }],
    },
    select: { id: true, model: true },
  });
  if (assistant) return { id: assistant.id, model: assistant.model || DEFAULT_LLM_MODEL };
  const any = await prisma.agent.findFirst({
    where: { status: { not: "deleted" }, tier: { in: ["manager", "super"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, model: true },
  });
  if (!any) throw new Error("无可用 Agent：请先创建 assistant 或超级 Agent");
  return { id: any.id, model: any.model || DEFAULT_LLM_MODEL };
}

export async function resolveOrCreateChannelBinding(
  prisma: PrismaClient,
  _services: ServiceContainer,
  config: AppConfig,
  input: {
    channel: ImChannel;
    peerId: string;
    chatId?: string | null;
    agentId?: string;
  },
): Promise<ChannelBindingRow> {
  const chatId = input.chatId?.trim() || "";
  const existing = await prisma.channelBinding.findUnique({
    where: {
      channel_peerId_chatId: {
        channel: input.channel,
        peerId: input.peerId,
        chatId,
      },
    },
  });
  if (existing) {
    await prisma.channelBinding.update({
      where: { id: existing.id },
      data: { lastMessageAt: new Date() },
    });
    return { ...existing, chatId: existing.chatId || null } as ChannelBindingRow;
  }

  let resolved: { id: string; model: string };
  if (input.agentId) {
    const a = await prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { id: true, model: true },
    });
    if (!a) throw new Error(`Agent 不存在: ${input.agentId}`);
    resolved = { id: a.id, model: a.model || DEFAULT_LLM_MODEL };
  } else {
    resolved = await resolveDefaultAgentId(prisma);
  }

  const title =
    input.title?.trim() ||
    `IM · ${input.channel} · ${input.peerId.slice(0, 12)}`;
  const model = resolved.model || config.llm.defaultModel || DEFAULT_LLM_MODEL;
  const dedicated = await prisma.chatSession.create({
    data: {
      title,
      // 侧栏/标签优先读 autoName；无首轮自动命名前也要可读
      autoName: title,
      model,
      agentId: resolved.id,
      isMainSession: false,
      status: "active",
      kind: "channel",
    },
  });

  const created = await prisma.channelBinding.create({
    data: {
      channel: input.channel,
      peerId: input.peerId,
      chatId,
      sessionId: dedicated.id,
      agentId: resolved.id,
      title,
      lastMessageAt: new Date(),
    },
  });
  return { ...created, chatId: created.chatId || null } as ChannelBindingRow;
}

export async function listChannelBindings(
  prisma: PrismaClient,
  opts?: { channel?: ImChannel; limit?: number },
): Promise<ChannelBindingRow[]> {
  const rows = await prisma.channelBinding.findMany({
    where: opts?.channel ? { channel: opts.channel } : undefined,
    orderBy: { lastMessageAt: "desc" },
    take: opts?.limit ?? 100,
  });
  return rows.map((r) => ({ ...r, chatId: r.chatId || null })) as ChannelBindingRow[];
}

export async function deleteChannelBinding(prisma: PrismaClient, id: string): Promise<boolean> {
  const n = await prisma.channelBinding.deleteMany({ where: { id } });
  return n.count > 0;
}
