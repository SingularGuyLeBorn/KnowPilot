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
import { resolveOrCreateChannelBinding } from "./channelBinding.js";
import { getStreamHub } from "./sessionStreamHub.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { wrapEmitForChannelReply } from "./channelStreamBridge.js";

export type ImChannel = "qq" | "feishu" | "telegram";

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
  const text = msg.payload.text?.trim();
  if (!text) return { ok: false, error: "空消息" };

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
    });

    const hub = getStreamHub();
    if (!hub) {
      stats.failed += 1;
      return { ok: false, error: "SessionStreamHub 未就绪" };
    }

    const body = {
      sessionId: binding.sessionId,
      agentId: binding.agentId,
      message: text,
      source: "user" as const,
      clientMessageId: eventId,
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
      // 会话占线：入用户队列，前端/drain 稍后消费
      await deps.services.sessionQueueItem
        .create({
          sessionId: binding.sessionId,
          kind: "user",
          content: text,
          source: msg.envelope.channel,
          sourceName: `im:${msg.envelope.peerId}`,
        })
        .catch((err) => { console.warn("[messageGateway.ts] best-effort failed:", err instanceof Error ? err.message : err); });
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
