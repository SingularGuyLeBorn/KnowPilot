/**
 * MessageGateway — IM 通道统一入站（对齐 MetaBlog / OpenClaw / Hermes 信封模式）。
 *
 * 原则：
 * - 单运行时：入站 → ChannelBinding → SessionStreamHub.startIfNotRunning（交互式，不入 async 池）
 * - Adapter 只做协议编解码；网关负责幂等、绑定、起流、回发
 * - 未配置凭证时 Adapter enabled=false，doctor 可体检
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { claimWebhookEvent } from "./webhookIdempotency.js";
import { resolveOrCreateChannelBinding, setDefaultChannelSession } from "./channelBinding.js";
import { getStreamHub } from "./sessionStreamHub.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { wrapEmitForChannelReply } from "./channelStreamBridge.js";
import { notifyAgentUi } from "./uiStateNotify.js";

export type ImChannel = "qq" | "feishu" | "telegram" | "onebot";

export type UnifiedMessage = {
  envelope: {
    channel: ImChannel;
    /** 对端稳定 id（QQ openid 等） */
    peerId: string;
    /** 群聊 id；单聊可空 */
    chatId?: string;
    timestamp: string;
  };
  payload: {
    text: string;
  };
  meta: {
    /** 通道侧事件幂等键（qq message id 等） */
    eventId: string;
    /** 通道回传字段（replyTo 等） */
    replyTo?: string;
    raw?: unknown;
  };
};

export type ChannelReplyChunk = {
  text: string;
  /** 流式是否结束 */
  finish: boolean;
  streamId?: string;
  /** 模型的 reasoning/thinking 内容；IM 渠道可额外转发给用户 */
  reasoning?: string;
};

export interface ChannelAdapter {
  readonly channel: ImChannel;
  readonly name: string;
  /** 凭证齐备且允许启动 */
  readonly enabled: boolean;
  /** 连接态：disconnected | connecting | connected | error */
  getStatus(): { state: string; detail?: string; lastError?: string };
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 向原渠道回发（流式分片或终稿） */
  reply(msg: UnifiedMessage, chunk: ChannelReplyChunk): Promise<void>;
}

export type GatewayHandleResult =
  | { ok: true; sessionId: string; duplicate?: boolean; busy?: boolean }
  | { ok: false; error: string };

type GatewayDeps = {
  prisma: PrismaClient;
  services: ServiceContainer;
  config: AppConfig;
};

const adapters = new Map<ImChannel, ChannelAdapter>();
let deps: GatewayDeps | null = null;
const stats = {
  received: 0,
  started: 0,
  duplicate: 0,
  busy: 0,
  failed: 0,
};

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
  console.log(`[MessageGateway] 注册渠道: ${adapter.name} (${adapter.channel}) enabled=${adapter.enabled}`);
}

export function getChannelAdapter(channel: ImChannel): ChannelAdapter | undefined {
  return adapters.get(channel);
}

export function listChannelAdapters(): ChannelAdapter[] {
  return [...adapters.values()];
}

export function getMessageGatewayStats() {
  return { ...stats, channels: Object.fromEntries(
    [...adapters.entries()].map(([k, a]) => [k, { enabled: a.enabled, ...a.getStatus() }]),
  ) };
}

export function initMessageGateway(next: GatewayDeps): void {
  deps = next;
}

/**
 * 处理归一化入站消息（Adapter / 单测共用）。
 * 幂等键写入 ProcessedWebhookEvent（source=im:{channel}）。
 */
export async function handleIncomingMessage(msg: UnifiedMessage): Promise<GatewayHandleResult> {
  if (!deps) return { ok: false, error: "MessageGateway 未初始化" };
  let text = msg.payload.text?.trim();
  if (!text) return { ok: false, error: "空消息" };

  // 检测「新话题」指令：/new /新话题 /开启一个新话题 /开启新话题 /换话题 /newtopic，或自然语言同义短语
  const newTopicMatch = text.match(
    /^(?:\/(?:new|新话题|newtopic|换话题|开启新话题|开启一个新话题)|新话题|开启新话题|开启一个新话题|换话题)\s*(.*)/i,
  );
  let forceChatId: string | undefined;
  if (newTopicMatch) {
    const topicLabel = newTopicMatch[1]?.trim();
    // chatId = 时间戳前缀 + 用户指定的主题名（截断 30 字）
    forceChatId = `${Date.now()}-${(topicLabel || "新话题").slice(0, 30)}`;
    // 把主题名作为第一条消息内容（若有）；否则用「开始新话题」
    text = topicLabel || "我们开始一个新话题。";
  }

  // 检测「清空上下文」指令：/clear 或 /重置
  const clearMatch = text.match(/^\/(?:clear|重置|清空|reset)\s*$/i);

  // 检测「强制停止当前回复」指令：/stop /force /停止 /强制停止
  const stopMatch = text.match(/^\/(?:stop|force|停止|强制停止)\s*$/i);

  stats.received += 1;
  const eventId = `${msg.envelope.channel}:${msg.meta.eventId}`;
  const claim = await claimWebhookEvent(deps.prisma, eventId, `im:${msg.envelope.channel}`, "im_chat");
  if (!claim.claimed) {
    stats.duplicate += 1;
    return { ok: true, sessionId: "", duplicate: true };
  }

  try {
    const binding = await resolveOrCreateChannelBinding(deps.prisma, deps.services, deps.config, {
      channel: msg.envelope.channel,
      peerId: msg.envelope.peerId,
      chatId: msg.envelope.chatId ?? null,
      forceChatId,
    });

    // /new 创建的新 session 要把默认绑定切过去，否则下一条无 chatId 的消息会回到旧 session
    if (newTopicMatch) {
      await setDefaultChannelSession(
        deps.prisma,
        msg.envelope.channel,
        msg.envelope.peerId,
        msg.envelope.chatId ?? null,
        binding.sessionId,
        binding.agentId,
      );
    }

    // 清空当前 IM session 上下文
    if (clearMatch) {
      await deps.prisma.chatMessage.deleteMany({ where: { sessionId: binding.sessionId } });
      // 推拉铁律：session 内容变化后推列表变更，让 web 侧栏/打开的标签页实时刷新
      await notifyAgentUi(deps.prisma, binding.agentId, { type: "session_list_changed" });
      const adapter = adapters.get(msg.envelope.channel);
      if (adapter) {
        await adapter.reply(msg, { text: "已清空当前会话上下文，继续聊吧。", finish: true }).catch(() => {});
      }
      return { ok: true, sessionId: binding.sessionId };
    }

    const hub = getStreamHub();

    // 强制停止当前 session 的 runner（专治 IM 侧 stuck 在「回复中」）
    if (stopMatch) {
      if (!hub) {
        stats.failed += 1;
        return { ok: false, error: "SessionStreamHub 未就绪" };
      }
      const stopped = hub.forceStop(binding.sessionId);
      const adapter = adapters.get(msg.envelope.channel);
      if (adapter) {
        await adapter
          .reply(
            msg,
            {
              text: stopped ? "已强制停止当前回复，可以继续发消息。" : "当前没有正在回复的消息。",
              finish: true,
            },
          )
          .catch(() => {});
      }
      return { ok: true, sessionId: binding.sessionId };
    }

    if (!hub) {
      stats.failed += 1;
      return { ok: false, error: "SessionStreamHub 未就绪" };
    }

    const session = await deps.prisma.chatSession.findUnique({
      where: { id: binding.sessionId },
      select: { systemPrompt: true },
    });

    const body = {
      sessionId: binding.sessionId,
      agentId: binding.agentId,
      message: text,
      source: "user" as const,
      clientMessageId: eventId,
      config: session?.systemPrompt ? { systemPrompt: session.systemPrompt } : undefined,
    };

    const invoke = createTrpcInvoker({
      services: deps.services,
      config: deps.config,
      prisma: deps.prisma,
    });
    const { chatAgentStream } = await import("./agentStream.js");

    const adapter = adapters.get(msg.envelope.channel);
    const started = await hub.startIfNotRunning(binding.sessionId, body, async (emit, signal) => {
      const channelEmit = adapter
        ? wrapEmitForChannelReply(emit, (chunk) =>
            adapter.reply(msg, chunk).catch((err) => {
              console.warn(
                `[MessageGateway] ${msg.envelope.channel} 回发失败:`,
                err instanceof Error ? err.message : err,
              );
            }),
          )
        : emit;
      await chatAgentStream(deps!.services, deps!.config, body, invoke, channelEmit, signal);
    });

    if (started === "busy") {
      stats.busy += 1;
      // IM 渠道没有前端 drain 消费 user 队列，直接回发「请稍等」避免消息永久挂起
      if (adapter) {
        void adapter
          .reply(msg, { text: "当前还在回复中，请稍后再发。", finish: true })
          .catch((err) => {
            console.warn(
              `[MessageGateway] ${msg.envelope.channel} busy 回发失败:`,
              err instanceof Error ? err.message : err,
            );
          });
      }
      return { ok: true, sessionId: binding.sessionId, busy: true };
    }
    if (started === "duplicate") {
      stats.duplicate += 1;
      return { ok: true, sessionId: binding.sessionId, duplicate: true };
    }
    stats.started += 1;
    return { ok: true, sessionId: binding.sessionId };
  } catch (err) {
    stats.failed += 1;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function startAllChannelAdapters(): Promise<void> {
  for (const adapter of adapters.values()) {
    if (!adapter.enabled) {
      console.log(`  📡 [IM] ${adapter.name} 未启用（缺凭证或 config 关闭）`);
      continue;
    }
    try {
      await adapter.start();
      console.log(`  📡 [IM] ${adapter.name} 已启动 · ${adapter.getStatus().state}`);
    } catch (err) {
      console.warn(
        `  ⚠️ [IM] ${adapter.name} 启动失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function stopAllChannelAdapters(): Promise<void> {
  for (const adapter of adapters.values()) {
    await adapter.stop().catch((err) => { console.warn("[messageGateway.ts] best-effort failed:", err instanceof Error ? err.message : err); });
  }
}

/** 单测 / 管理页「模拟入站」 */
export async function __resetMessageGatewayForTests(): Promise<void> {
  adapters.clear();
  deps = null;
  stats.received = 0;
  stats.started = 0;
  stats.duplicate = 0;
  stats.busy = 0;
  stats.failed = 0;
}
