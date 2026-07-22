/**
 * SessionStreamHub subscribeExternal 重放过滤：message_upserted 不重放，
 * 其它幂等 refetch 事件照常重放。消息列表的权威恢复通道是 hydrate/listForChat。
 */

import { describe, it, expect } from "vitest";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";
import type { AgentStreamEvent } from "../infra/agentStream.js";

const SID = "replay-sess-1";

describe("SessionStreamHub subscribeExternal 重放过滤", () => {
  it("message_upserted 不重放，session_queue_update 等事件仍重放", () => {
    const hub = new SessionStreamHub({ persist: false, cleanupIntervalMs: 0 });
    const received: string[] = [];
    const onEvent = (ev: AgentStreamEvent) => received.push(ev.type);

    hub.pushExternalEvent(SID, {
      type: "message_upserted",
      sessionId: SID,
      message: {
        id: "m1",
        role: "assistant",
        content: "hello",
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    });
    hub.pushExternalEvent(SID, {
      type: "session_queue_update",
      sessionId: SID,
      kind: "user",
    });
    hub.pushExternalEvent(SID, {
      type: "message_deleted",
      sessionId: SID,
      messageId: "m2",
    });

    hub.subscribeExternal(SID, onEvent);
    expect(received).toEqual(["session_queue_update", "message_deleted"]);
  });
});
