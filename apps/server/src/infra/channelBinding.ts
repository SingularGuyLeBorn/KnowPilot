/**
 * ChannelBinding — (channel, peerId[, chatId]) ↔ ChatSession 映射。
 * 本地优先：绑定存 SQLite；每条对端独占一个 kind=channel 会话（不占主会话）。
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import type { ImChannel } from "./messageGateway.js";
import { DEFAULT_LLM_MODEL, TIER_DEFAULT_TOOLS } from "@knowpilot/shared";

const DAILY_FRAGMENTS_SOURCE = "onebot-daily-fragments";
const DAILY_FRAGMENTS_AGENT_NAME = "每日碎片整理员";
const DAILY_FRAGMENTS_WS_NAME = "每日碎片";
const DAILY_FRAGMENTS_WS_PATH = "workspaces/daily-fragments";

let dailyFragmentsAgentCache: { id: string; model: string } | null = null;

async function resolveDailyFragmentsAgent(
  prisma: PrismaClient,
  services: ServiceContainer,
  config: AppConfig,
): Promise<{ id: string; model: string } | null> {
  if (dailyFragmentsAgentCache) return dailyFragmentsAgentCache;

  const existing = await prisma.agent.findFirst({
    where: {
      status: { not: "deleted" },
      OR: [
        { source: DAILY_FRAGMENTS_SOURCE },
        { name: DAILY_FRAGMENTS_AGENT_NAME },
      ],
    },
    select: { id: true, model: true, workspaceId: true },
  });
  if (existing) {
    dailyFragmentsAgentCache = { id: existing.id, model: existing.model || DEFAULT_LLM_MODEL };
    return dailyFragmentsAgentCache;
  }

  try {
    const wsResult = await services.workspace.create({
      name: DAILY_FRAGMENTS_WS_NAME,
      description: "整理每日碎片思考、灵感、待办与随心笔记",
      path: DAILY_FRAGMENTS_WS_PATH,
      autoCreateManager: false,
    });
    if (!wsResult.success || !wsResult.data) {
      console.warn(`[channelBinding] 创建 ${DAILY_FRAGMENTS_WS_NAME} Workspace 失败:`, wsResult.error?.message ?? "未知");
      return null;
    }
    const wsId = (wsResult.data as { id: string }).id;

    const agentResult = await services.agent.create({
      name: DAILY_FRAGMENTS_AGENT_NAME,
      description: `${DAILY_FRAGMENTS_WS_NAME} Workspace 的管理 Agent，负责整理用户的每日碎片思考`,
      model: config.llm.defaultModel ?? DEFAULT_LLM_MODEL,
      systemPrompt: `你是「${DAILY_FRAGMENTS_WS_NAME}」Workspace 的管理 Agent，专注整理用户的每日碎片思考、灵感、待办与随心笔记。

OasisMind 是「以 Markdown 为原子、AI 为引擎的数字花园」。你是这座花园里「每日碎片」区块的园丁长：负责把用户通过 QQ 随手丢进来的想法分类、提炼、归档，并适时生成可回顾的笔记或任务。

你的职责：
- 倾听用户的碎片化表达（一句话、一个灵感、一段情绪、一个待办）
- 用 memory_create 把值得保留的点记录到本 Workspace 记忆
- 用 memory_search 检索相关历史碎片，帮助用户发现关联
- 必要时用 skill_* 或 post_create 生成整理后的文章/笔记
- 对模糊的内容，用 ask_user 在 QQ 回问确认（channel=onebot）
- 向上级（超级 Agent）汇报本空间整体状态

行为准则：
- 不越界：不创建/归档 Workspace，不创建子 Agent（除非被用户明确请求）
- 本地优先：整理后的内容优先落库/落文件，不依赖外部 SaaS
- 隐私敏感：本空间内容仅供用户本人回顾，不主动外传
- 子 Agent 隔离铁律：结果经 report_back，不看子会话消息内容`,
      tools: TIER_DEFAULT_TOOLS.manager,
      tier: "manager",
      workspaceId: wsId,
      source: DAILY_FRAGMENTS_SOURCE,
    });
    if (!agentResult.success || !agentResult.data) {
      console.warn(`[channelBinding] 创建 ${DAILY_FRAGMENTS_AGENT_NAME} 失败:`, agentResult.error?.message ?? "未知");
      return null;
    }
    const agentId = (agentResult.data as { id: string }).id;
    dailyFragmentsAgentCache = { id: agentId, model: (agentResult.data as { model?: string }).model || DEFAULT_LLM_MODEL };
    console.log(`[channelBinding] 已创建 ${DAILY_FRAGMENTS_WS_NAME} Workspace + ${DAILY_FRAGMENTS_AGENT_NAME} (${agentId})`);
    return dailyFragmentsAgentCache;
  } catch (err) {
    console.warn(`[channelBinding] 创建每日碎片专属 Agent 失败:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** 测试隔离：清空每日碎片 Agent 缓存 */
export function __resetDailyFragmentsAgentCache(): void {
  dailyFragmentsAgentCache = null;
}

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
  const qqBot = await prisma.agent.findFirst({
    where: {
      status: { not: "deleted" },
      OR: [{ sourceSlug: "qq-bot" }, { name: { contains: "QQ" } }],
    },
    select: { id: true, model: true },
  });
  if (qqBot) return { id: qqBot.id, model: qqBot.model || DEFAULT_LLM_MODEL };

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
    /** 若传入，强制用此 chatId 作绑定 key（即创建新 Session），忽略现有绑定 */
    forceChatId?: string;
  },
): Promise<ChannelBindingRow> {
  const chatId = input.forceChatId?.trim() || input.chatId?.trim() || "";
  const existing = !input.forceChatId
    ? await prisma.channelBinding.findUnique({
        where: {
          channel_peerId_chatId: {
            channel: input.channel,
            peerId: input.peerId,
            chatId,
          },
        },
      })
    : null; // forceChatId 时跳过查找，直接创建新 Session

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
  } else if (input.channel === "onebot") {
    const dedicated = await resolveDailyFragmentsAgent(prisma, _services, config);
    resolved = dedicated ?? (await resolveDefaultAgentId(prisma));
  } else {
    resolved = await resolveDefaultAgentId(prisma);
  }

  const title = chatId
    ? `IM · ${input.channel} · ${input.peerId.slice(0, 12)} · ${chatId.slice(0, 20)}`
    : `IM · ${input.channel} · ${input.peerId.slice(0, 12)}`;
  const model = resolved.model || config.llm.defaultModel || DEFAULT_LLM_MODEL;
  const dedicated = await prisma.chatSession.create({
    data: {
      title,
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
