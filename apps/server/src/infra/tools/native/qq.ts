/**
 * QQ 渠道原生工具 — 让 Agent 主动发送图片/视频到 OneBot（NapCat / LLOneBot）私聊或群聊。
 *
 * 设计：
 * - 入站消息经 ChannelBinding 与会话关联；工具从 ctx.sessionId 反查对端身份。
 * - 也支持显式传入 userId / groupId，便于跨会话场景或测试。
 * - file 支持本地相对路径（项目根目录）或 HTTP URL。
 */

import { z } from "zod";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { zodParams } from "./zodParams.js";
import { registerNativeDomain } from "./registerDomain.js";

const qqMediaDefBase = {
  parameters: zodParams(
    z.object({
      file: z.string().describe("图片/视频文件路径（相对项目根目录，如 content/uploads/xxx.png）或 HTTP URL"),
      caption: z.string().describe(" accompanying 文本说明，可选").optional(),
      userId: z.string().describe("目标 QQ 号（私聊）；不填则尝试从当前会话的 ChannelBinding 反查").optional(),
      groupId: z.string().describe("目标群号（群聊）；不填则尝试从当前会话的 ChannelBinding 反查").optional(),
    }),
  ),
  concurrencyClass: "B" as const,
  destructive: false,
};

export const qqDefs: NativeToolDefinition[] = [
  {
    name: "send_qq_image",
    description:
      "通过 OneBot / QQ 渠道发送一张图片给用户或群。file 可以是本地路径（如 content/uploads/xxx.png）或 HTTP URL。" +
      "若当前会话来自 QQ 渠道且未显式指定 userId/groupId，则自动发给当前对端。",
    ...qqMediaDefBase,
  },
  {
    name: "send_qq_video",
    description:
      "通过 OneBot / QQ 渠道发送一个视频给用户或群。file 可以是本地路径（如 content/uploads/xxx.mp4）或 HTTP URL。" +
      "若当前会话来自 QQ 渠道且未显式指定 userId/groupId，则自动发给当前对端。",
    ...qqMediaDefBase,
  },
];

async function resolveOneBotTarget(ctx: NativeToolContext): Promise<{ userId?: string; groupId?: string } | null> {
  if (!ctx.prisma || !ctx.sessionId) return null;
  const { findChannelBindingBySessionId } = await import("../../channelBinding.js");
  const binding = await findChannelBindingBySessionId(ctx.prisma, ctx.sessionId);
  if (!binding) return null;
  return {
    userId: binding.peerId,
    groupId: binding.chatId ?? undefined,
  };
}

async function sendQqMediaTool(
  args: Record<string, unknown>,
  ctx: NativeToolContext,
  type: "image" | "video",
): Promise<unknown> {
  const file = String(args.file || "").trim();
  if (!file) return { error: "缺少 file 参数" };

  let userId = args.userId ? String(args.userId) : undefined;
  let groupId = args.groupId ? String(args.groupId) : undefined;

  if (!userId && !groupId) {
    const target = await resolveOneBotTarget(ctx);
    if (target) {
      userId = target.userId;
      groupId = target.groupId;
    }
  }

  if (!userId && !groupId) {
    return {
      error: "缺少 userId/groupId，且无法从当前会话推断出 QQ 对端身份。请显式传入 userId 或 groupId。",
    };
  }

  const { getChannelAdapter } = await import("../../messageGateway.js");
  const adapter = getChannelAdapter("onebot");
  if (!adapter) {
    return { error: "OneBot 适配器未注册：请确认 ONEBOT_HTTP_URL 已配置并重启服务。" };
  }

  const a = adapter as {
    sendImage?: (payload: { userId?: string; groupId?: string; file: string; caption?: string }) => Promise<unknown>;
    sendVideo?: (payload: { userId?: string; groupId?: string; file: string; caption?: string }) => Promise<unknown>;
  };

  const send = type === "image" ? a.sendImage : a.sendVideo;
  if (!send) {
    return { error: `OneBot 适配器不支持 ${type} 发送` };
  }

  try {
    const result = await send({ userId, groupId, file, caption: args.caption ? String(args.caption) : undefined });
    return { ok: true, type, file, userId, groupId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `发送 ${type} 失败: ${message}`, type, file, userId, groupId };
  }
}

const sendQqImage: NativeToolHandler = async (args, ctx) => sendQqMediaTool(args, ctx, "image");
const sendQqVideo: NativeToolHandler = async (args, ctx) => sendQqMediaTool(args, ctx, "video");

export const qqHandlers: Record<string, NativeToolHandler> = {
  send_qq_image: sendQqImage,
  send_qq_video: sendQqVideo,
};

export function registerQqTools(): void {
  registerNativeDomain(qqDefs, qqHandlers);
}
