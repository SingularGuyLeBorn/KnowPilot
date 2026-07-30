/**
 * 把 SessionStreamHub 的 token/done 折成渠道回发分片（节流）。
 */

import { randomUUID } from "node:crypto";
import type { AgentStreamEvent } from "./agentStream.js";
import type { ChannelReplyChunk } from "./messageGateway.js";

const FLUSH_MS = 450;

/**
 * 包装 hub emit：先转发给 SSE 订阅方，再节流回渠道。
 */
export function wrapEmitForChannelReply(
  emit: (event: AgentStreamEvent) => void,
  onChunk: (chunk: ChannelReplyChunk) => void | Promise<void>,
): (event: AgentStreamEvent) => void {
  let buf = "";
  const streamId = randomUUID().replace(/-/g, "").slice(0, 24);
  let lastFlush = 0;
  let finished = false;

  const flush = (finish: boolean) => {
    if (finished && finish) return;
    if (finish) finished = true;
    lastFlush = Date.now();
    void Promise.resolve(onChunk({ text: buf, finish, streamId })).catch((err) => { console.warn("[channelStreamBridge.ts] best-effort failed:", err instanceof Error ? err.message : err); });
  };

  return (event: AgentStreamEvent) => {
    emit(event);
    if (event.type === "token" && event.delta) {
      buf += event.delta;
      const now = Date.now();
      if (now - lastFlush >= FLUSH_MS) flush(false);
    } else if (event.type === "done") {
      flush(true);
    } else if (event.type === "error") {
      if (!buf) buf = `（生成失败）${event.message || ""}`;
      flush(true);
    }
  };
}

/** 兼容旧名：在 runner 内直接包 emit */
export function bridgeSessionReplyToChannel(opts: {
  emit: (event: AgentStreamEvent) => void;
  onChunk: (chunk: ChannelReplyChunk) => void | Promise<void>;
  /** 保留参数以兼容调用方；实际用 wrapEmit */
  sessionId?: string;
  hub?: unknown;
  signal?: AbortSignal;
}): (event: AgentStreamEvent) => void {
  return wrapEmitForChannelReply(opts.emit, opts.onChunk);
}
