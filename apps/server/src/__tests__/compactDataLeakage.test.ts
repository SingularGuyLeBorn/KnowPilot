/**
 * Auto-Compact 数据暴露审计 — 摘要不得经工具返回值 / 历史重建重复送入 LLM
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import {
  maybeCompactMessages,
  persistCompactResult,
  runSessionCompact,
  SUMMARY_MARKER,
  buildCompactBoundaryMarker,
} from "../infra/autoCompact.js";
import { buildLlmMessagesFromHistory, sliceHistoryAfterCompactBoundary } from "../infra/chatHistory.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import * as llmClient from "../infra/llmClient.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import fs from "fs";

const SECRET = "SECRET_API_KEY_9f3e2a1b";

function makeConfig(overrides?: Partial<AppConfig["compact"]>): AppConfig {
  return createTestConfig("/tmp", {
    compact: {
      enabled: true,
      triggerRatio: 0.05,
      keepRecent: 4,
      microCompact: { enabled: true, toolResultMaxChars: 4000 },
      memoryFlush: { enabled: false, maxFacts: 5 },
      ...overrides,
    },
  });
}

function longHistoryItems(count: number, charsEach = 500) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: `消息-${i}-` + "x".repeat(charsEach),
  }));
}

function countSummaryOccurrences(messages: { role: string; content: unknown }[], needle: string): number {
  return messages.reduce((n, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    const hits = text.split(needle).length - 1;
    return n + (hits > 0 ? hits : 0);
  }, 0);
}

describe("compact 数据暴露审计", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let llmSpy: any;

  beforeEach(() => {
    llmSpy = vi.spyOn(llmClient, "chatCompletion").mockResolvedValue({
      content: `摘要：用户曾提到 ${SECRET}，后续勿复述。`,
      tool_calls: undefined,
      usage: undefined,
    } as any);
  });

  afterEach(() => {
    llmSpy.mockRestore();
  });

  it("persistCompactResult 边界消息 tool result 不含完整摘要", async () => {
    const sessionUpdates: unknown[] = [];
    const createdMessages: unknown[] = [];
    const services = {
      session: {
        update: vi.fn(async (input: unknown) => {
          sessionUpdates.push(input);
          return { success: true };
        }),
      },
      message: {
        create: vi.fn(async (input: unknown) => {
          createdMessages.push(input);
          return { success: true, data: { id: "boundary-1" } };
        }),
      },
    } as unknown as ServiceContainer;

    await persistCompactResult(
      services,
      "sess-1",
      {
        compacted: true,
        messages: [],
        summaryText: `完整摘要含 ${SECRET}`,
        generation: 1,
        messagesSummarized: 12,
        charBefore: 10000,
        charAfter: 2000,
      },
      { trigger: "agent" },
    );

    expect(sessionUpdates).toHaveLength(1);
    expect((sessionUpdates[0] as { contextSummary?: string }).contextSummary).toContain(SECRET);

    const boundary = createdMessages[0] as {
      toolCalls?: Array<{ name: string; result?: Record<string, unknown> }>;
    };
    const compactTc = boundary.toolCalls?.find((t) => t.name === "__context_compact__");
    expect(compactTc).toBeDefined();
    expect(compactTc?.result?.summary).toBeUndefined();
    expect(JSON.stringify(compactTc?.result ?? {})).not.toContain(SECRET);
  });

  it("buildLlmMessagesFromHistory 跳过 __context_compact__ 工具链，仅保留短边界正文", () => {
    const generation = 2;
    const boundaryMarker = buildCompactBoundaryMarker(generation);
    const messages = buildLlmMessagesFromHistory("sys", [
      {
        role: "assistant",
        content: `${boundaryMarker}\n已压缩上下文：12 条旧消息已摘要。`,
        toolCalls: [
          {
            id: "compact_v2",
            name: "__context_compact__",
            kind: "compact",
            args: { trigger: "agent", generation, messagesSummarized: 12 },
            result: {
              summary: `不应出现的摘要 ${SECRET}`,
              boundary: boundaryMarker,
              trigger: "agent",
            },
          },
        ],
      },
      { role: "user", content: "继续聊" },
    ]);

    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(0);
    expect(JSON.stringify(messages)).not.toContain(SECRET);
    expect(messages.some((m) => m.role === "assistant" && String(m.content).includes("已压缩上下文"))).toBe(true);
  });

  it("maybeCompactMessages 复用摘要时 LLM 上下文仅注入一份摘要", async () => {
    const existing = `已有摘要：${SECRET}`;
    const history = buildLlmMessagesFromHistory("sys", [
      {
        role: "assistant",
        content: "[kp-compact-boundary:v1@2026-01-01T00:00:00.000Z]\n已压缩。",
        toolCalls: [
          {
            id: "c1",
            name: "__context_compact__",
            kind: "compact",
            args: {},
            result: { boundary: "x", trigger: "auto" },
          },
        ],
      },
      { role: "user", content: "新问题 A" },
      { role: "assistant", content: "回答 A" },
      { role: "user", content: "新问题 B" },
    ]);

    const result = await maybeCompactMessages(makeConfig(), history, "deepseek-v4-flash", {
      existingSummary: existing,
    });

    expect(result.compacted).toBe(true);
    expect(result.reused).toBe(true);
    expect(countSummaryOccurrences(result.messages, SECRET)).toBe(1);
    expect(countSummaryOccurrences(result.messages, SUMMARY_MARKER)).toBe(1);
    expect(llmSpy).not.toHaveBeenCalled();
  });

  it("session_compact 工具返回值不含 summaryPreview / 摘要正文", async () => {
    const root = createTempProjectDir();
    const secretSummary = `摘要正文 ${SECRET}`;

    const services = {
      session: {
        getByIdLite: vi.fn().mockResolvedValue({
          id: "sess-1",
          model: "deepseek-v4-flash",
          systemPrompt: "sys",
          status: "active",
          contextSummary: null,
        }),
        update: vi.fn().mockResolvedValue({ success: true }),
      },
      message: {
        list: vi.fn().mockResolvedValue({
          items: longHistoryItems(40, 500),
          total: 40,
        }),
        create: vi.fn().mockResolvedValue({ success: true, data: { id: "boundary-2" } }),
      },
    };

    llmSpy.mockResolvedValueOnce({
      content: secretSummary,
      tool_calls: undefined,
      usage: undefined,
    } as any);

    const ctx = {
      config: makeConfig(),
      projectRoot: root,
      services: services as unknown as ServiceContainer,
      sessionId: "sess-1",
      invokeTrpc: vi.fn(),
      agentSnapshot: {
        id: "mgr-1",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        tools: ["native:session_compact"],
        tier: "manager" as const,
        workspaceId: "ws-1",
      },
    };

    const result = (await executeNativeTool("session_compact", { reason: "用户要求" }, ctx)) as Record<
      string,
      unknown
    >;

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.summaryPreview).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(services.session.update).toHaveBeenCalled();
    const updateArg = (services.session.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      contextSummary?: string;
    };
    expect(updateArg.contextSummary).toContain(SECRET);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("runSessionCompact 将摘要写入 session.contextSummary，tRPC 可返回 summaryPreview 但不进 Agent 工具链", async () => {
    const services = {
      session: {
        getByIdLite: vi.fn(),
        update: vi.fn().mockResolvedValue({ success: true }),
      },
      message: {
        list: vi.fn().mockResolvedValue({
          items: longHistoryItems(40, 500),
          total: 40,
        }),
        create: vi.fn().mockResolvedValue({ success: true, data: { id: "b-3" } }),
      },
    } as unknown as ServiceContainer;

    const result = await runSessionCompact({
      config: makeConfig(),
      services,
      sessionId: "sess-t",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      trigger: "manual",
    });

    expect(result.compacted).toBe(true);
    expect(result.summaryPreview).toContain(SECRET);
    const boundaryCreate = (services.message.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      toolCalls?: Array<{ result?: Record<string, unknown> }>;
    };
    expect(JSON.stringify(boundaryCreate.toolCalls ?? [])).not.toContain(SECRET);
  });

  it("sliceHistoryAfterCompactBoundary 后 rebuild 不含边界前的旧对话", () => {
    const boundary = buildCompactBoundaryMarker(1);
    const history = sliceHistoryAfterCompactBoundary([
      { role: "user", content: `旧对话 ${SECRET}` },
      { role: "assistant", content: "旧答" },
      {
        role: "assistant",
        content: `${boundary}\n已压缩。`,
        toolCalls: [{ id: "c1", name: "__context_compact__", kind: "compact", args: {}, result: {} }],
      },
      { role: "user", content: "继续" },
    ]);
    const messages = buildLlmMessagesFromHistory("sys", history);
    expect(JSON.stringify(messages)).not.toContain(SECRET);
    expect(messages.some((m) => String(m.content).includes("继续"))).toBe(true);
  });
});
