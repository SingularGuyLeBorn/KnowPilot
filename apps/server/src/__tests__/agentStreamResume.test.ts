import { describe, it, expect, vi } from "vitest";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";
import { handleAgentChatStream } from "../infra/agentStream.js";
import type { AppConfig } from "../infra/config.js";

/**
 * 回归测试：子 Agent session 卡 "Thinking..." 空气泡的根因与防护。
 *
 * 根因：当客户端对一个「已结束运行」的 session 发起 GET 续传（resumeAfter > 0）时，
 *   如果 Hub 中没有可重放的事件（run state 已清理 / 服务端重启后 persist 关闭），
 *   旧代码直接 res.end() 关闭连接、不发 done 事件。
 *   前端 readOneConnection 收到流关闭但没 done/error → finished=false → 进入重连循环
 *   （最多 12 次、约 2 分钟），期间 isStreaming 一直为 true，UI 卡在 "Thinking..."。
 *
 * 修复：agentStream.ts L1112 —— 订阅后若 !isRunning && !ended，主动发 done 再 end()。
 * 本测试锁定该契约：断开连接前必须写出一个 type=done 的 SSE 事件。
 */
describe("Agent SSE 续传：已结束 session 必须发 done（防卡 Thinking）", () => {
  it("GET 续传非运行中的 session（有 afterEventId）时，响应中包含 done 事件", async () => {
    // persist: false → 不查 DB，纯内存；session 从未 start → isRunning=false，无缓冲事件可重放
    const hub = new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 });

    const config = { auth: { mode: "none", password: "", token: "" } } as unknown as AppConfig;
    const handler = handleAgentChatStream(
      {} as any, // services：resume 路径不使用
      config,
      (async () => {}) as any, // invokeTrpc：resume 路径不使用
      hub,
    );

    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => writes.push(chunk)),
      end: vi.fn(),
      on: vi.fn(),
    } as any;

    const req = {
      method: "GET",
      query: { sessionId: "test-session-done", resumeAfter: "5" },
      body: {},
      headers: {},
    } as any;

    await handler(req, res);

    // done 事件在 setTimeout(_, 0) 中写出，等一个宏任务
    await new Promise((r) => setTimeout(r, 10));

    const allOutput = writes.join("");
    expect(allOutput).toContain("event: done");
    expect(res.end).toHaveBeenCalled();
  });

  it("GET 续传非运行中的 session（afterEventId=0）时，返回 error 而非静默关闭", async () => {
    const hub = new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 });
    const config = { auth: { mode: "none", password: "", token: "" } } as unknown as AppConfig;
    const handler = handleAgentChatStream({} as any, config, (async () => {}) as any, hub);

    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => writes.push(chunk)),
      end: vi.fn(),
      on: vi.fn(),
    } as any;

    const req = {
      method: "GET",
      query: { sessionId: "test-session-norun", resumeAfter: "0" },
      body: {},
      headers: {},
    } as any;

    await handler(req, res);
    const allOutput = writes.join("");
    // afterEventId=0 且非运行 → 走 error 分支，不会卡住前端
    expect(allOutput).toContain("event: error");
    expect(res.end).toHaveBeenCalled();
  });
});
