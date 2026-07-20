/**
 * W5：compaction 切割合法性 + 迭代边界 + overflow 重试 + 文件清单
 *
 * 负向断言（旧实现红）：
 * - 切点不得落在 toolCall 与 toolResult 之间
 * - 二次压缩从 firstKept / 边界起算（不靠解析摘要文本）
 * - overflow 仅重试一次后上抛
 * - 跨压缩 readFiles/modifiedFiles 累计去重
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LlmMessage } from "../infra/llmClient.js";
import {
  findCompactCutIndex,
  toolPairsComplete,
  extractFileOpsFromMessages,
  mergeCompactFileDetails,
  parseCompactFileDetails,
  formatCompactFileDetails,
  DEFAULT_KEEP_RECENT_TOKENS,
} from "../infra/compactCut.js";
import {
  maybeCompactMessages,
  getCompactSettings,
  persistCompactResult,
  type CompactResult,
} from "../infra/autoCompact.js";
import {
  classifyLlmError,
  isContextOverflowError,
  LlmResilienceError,
} from "../infra/resilientLlmClient.js";
import { LlmHttpError } from "../infra/llmClient.js";
import { completeWithOverflowCompact } from "../infra/overflowCompactRetry.js";
import * as llmClient from "../infra/llmClient.js";
import type { AppConfig } from "../infra/config.js";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { createTempProjectDir } from "./helpers/toolTestFixtures.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import fs from "fs";

function assistantWithTools(
  callIds: string[],
  names: string[] = callIds.map(() => "read_file"),
  argsList: Record<string, unknown>[] = callIds.map(() => ({ path: "a.ts" })),
): LlmMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: callIds.map((id, i) => ({
      id,
      type: "function" as const,
      function: {
        name: names[i] ?? "read_file",
        arguments: JSON.stringify(argsList[i] ?? { path: "a.ts" }),
      },
    })),
  };
}

function toolResult(callId: string, content = "ok"): LlmMessage {
  return { role: "tool", tool_call_id: callId, content };
}

function makeConfig(over?: Partial<AppConfig["compact"]>): AppConfig {
  return {
    compact: {
      enabled: true,
      triggerRatio: 0.05,
      keepRecent: 4,
      keepRecentTokens: 50,
      summaryModel: "auto",
      microCompact: { enabled: false, toolResultMaxChars: 4000 },
      memoryFlush: { enabled: false, maxFacts: 5 },
      ...over,
    },
  } as AppConfig;
}

describe("compactCut 切割合法性", () => {
  it("toolPairsComplete：缺 result 或缺 call 均 false", () => {
    const callOnly = [assistantWithTools(["c1"]), { role: "user", content: "x" } as LlmMessage];
    expect(toolPairsComplete(callOnly)).toBe(false);

    const resultOnly = [toolResult("c1")];
    expect(toolPairsComplete(resultOnly)).toBe(false);

    const ok = [assistantWithTools(["c1"]), toolResult("c1")];
    expect(toolPairsComplete(ok)).toBe(true);
  });

  it("切点不落在 tool 对中间：初切落在 tool result 时向旧侧移到安全边界", () => {
    // 构造：user / assistant+tools / tool / user / assistant（长文本占 token）
    const msgs: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      assistantWithTools(["t1"]),
      toolResult("t1", "r".repeat(200)),
      { role: "user", content: "u2-" + "y".repeat(400) },
      { role: "assistant", content: "a2-" + "z".repeat(400) },
    ];
    // keepRecentTokens 很小 → 初切会落在靠后位置；若落在 tool 上必须修正
    const cut = findCompactCutIndex(msgs, 80);
    expect(msgs[cut]?.role).not.toBe("tool");
    expect(toolPairsComplete(msgs.slice(0, cut))).toBe(true);
    expect(toolPairsComplete(msgs.slice(cut))).toBe(true);
  });

  it("多轮 toolCalls 序列：任意 keepRecentTokens 切点两侧 call/result 成对", () => {
    const msgs: LlmMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 6; i++) {
      msgs.push({ role: "user", content: `u${i}-` + "x".repeat(100) });
      const id = `call_${i}`;
      msgs.push(assistantWithTools([id], ["read_file"], [{ path: `f${i}.ts` }]));
      msgs.push(toolResult(id, "data".repeat(40)));
    }
    for (const budget of [30, 80, 200, 2000, DEFAULT_KEEP_RECENT_TOKENS]) {
      const cut = findCompactCutIndex(msgs, budget);
      expect(toolPairsComplete(msgs.slice(0, cut))).toBe(true);
      expect(toolPairsComplete(msgs.slice(cut))).toBe(true);
      if (cut < msgs.length) expect(msgs[cut]?.role).not.toBe("tool");
    }
  });
});

describe("compactCut 迭代边界", () => {
  it("二次压缩从 startIndex（上次 firstKept）起算，不回看更旧消息", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "old-" + "a".repeat(500) },
      { role: "assistant", content: "old-a-" + "b".repeat(500) },
      { role: "user", content: "kept-start-" + "c".repeat(50) },
      { role: "assistant", content: "kept-a-" + "d".repeat(50) },
      { role: "user", content: "recent-" + "e".repeat(200) },
      { role: "assistant", content: "recent-a-" + "f".repeat(200) },
    ];
    const firstKept = 3; // "kept-start"
    const cut = findCompactCutIndex(msgs, 40, firstKept);
    expect(cut).toBeGreaterThanOrEqual(firstKept);
    // 被摘要段不得包含 firstKept 之前的消息
    expect(cut).toBeGreaterThan(firstKept);
  });

  it("persist 写入 compactBoundaryMessageId（显式列，不靠摘要 marker）", async () => {
    const root = createTempProjectDir();
    const ctx = await createContextInner();
    const services = ctx.services as ServiceContainer;
    const sess = await prisma.chatSession.create({
      data: { title: "cut-boundary", model: "test", compactGeneration: 0 },
    });
    try {
      const compacted: CompactResult = {
        compacted: true,
        messages: [],
        summaryText: "摘要正文",
        generation: 1,
        messagesSummarized: 3,
        charBefore: 1000,
        charAfter: 100,
        fileDetails: { readFiles: ["a.ts"], modifiedFiles: [] },
      };
      const r = await persistCompactResult(services, sess.id, compacted, { trigger: "manual" });
      expect(r.skipped).toBe(false);
      expect(r.boundaryMessageId).toBeTruthy();

      const updated = await prisma.chatSession.findUnique({ where: { id: sess.id } });
      expect((updated as { compactBoundaryMessageId?: string | null }).compactBoundaryMessageId).toBe(
        r.boundaryMessageId,
      );
    } finally {
      await prisma.chatMessage.deleteMany({ where: { sessionId: sess.id } });
      await prisma.chatSession.deleteMany({ where: { id: sess.id } });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("compactCut overflow 分类与重试", () => {
  it("classifyLlmError：context overflow 单列 overflow", () => {
    expect(classifyLlmError(400, "maximum context length exceeded")).toBe("overflow");
    expect(classifyLlmError(400, "This model's maximum context length is 128000 tokens")).toBe(
      "overflow",
    );
    expect(classifyLlmError(400, "bad request")).toBe("fatal");
    expect(isContextOverflowError(new LlmHttpError("ctx", 400, "prompt is too long"))).toBe(true);
    expect(
      isContextOverflowError(
        new LlmResilienceError("o", "overflow", 400, false, "上下文溢出", undefined),
      ),
    ).toBe(true);
  });

  it("overflow 重试一次后仍失败则上抛", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(
        new LlmResilienceError("overflow", "overflow", 400, false, "上下文溢出"),
      )
      .mockRejectedValueOnce(
        new LlmResilienceError("overflow2", "overflow", 400, false, "上下文溢出"),
      );
    const compactOnce = vi.fn().mockResolvedValue({ didCompact: true });

    await expect(
      completeWithOverflowCompact({
        complete: () => complete(),
        compactOnce,
      }),
    ).rejects.toMatchObject({ classification: "overflow" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(compactOnce).toHaveBeenCalledTimes(1);
  });

  it("overflow 压缩后重试成功", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(
        new LlmResilienceError("overflow", "overflow", 400, false, "上下文溢出"),
      )
      .mockResolvedValueOnce({ content: "ok", toolCalls: [] });
    const compactOnce = vi.fn().mockResolvedValue({ didCompact: true });

    const result = await completeWithOverflowCompact({
      complete: () => complete(),
      compactOnce,
    });
    expect(result).toMatchObject({ content: "ok" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(compactOnce).toHaveBeenCalledTimes(1);
  });
});

describe("compactCut 文件清单累计", () => {
  it("从工具参数提取 read/write 路径并去重合并", () => {
    const msgs: LlmMessage[] = [
      assistantWithTools(
        ["r1", "w1", "r2"],
        ["read_file", "write_file", "read_file"],
        [{ path: "a.ts" }, { path: "b.ts" }, { path: "a.ts" }],
      ),
      toolResult("r1"),
      toolResult("w1"),
      toolResult("r2"),
    ];
    const ops = extractFileOpsFromMessages(msgs);
    expect(ops.readFiles).toEqual(["a.ts"]);
    expect(ops.modifiedFiles).toEqual(["b.ts"]);

    const merged = mergeCompactFileDetails(
      { readFiles: ["a.ts", "c.ts"], modifiedFiles: ["b.ts"] },
      { readFiles: ["c.ts"], modifiedFiles: ["d.ts"] },
    );
    expect(merged.readFiles).toEqual(["a.ts", "c.ts"]);
    expect(merged.modifiedFiles.sort()).toEqual(["b.ts", "d.ts"]);
  });

  it("摘要文本嵌入 details JSON，二次合并去重", () => {
    const body = "历史摘要";
    const withDetails = formatCompactFileDetails(body, {
      readFiles: ["x.ts"],
      modifiedFiles: ["y.ts"],
    });
    expect(parseCompactFileDetails(withDetails)).toEqual({
      readFiles: ["x.ts"],
      modifiedFiles: ["y.ts"],
    });
    const again = formatCompactFileDetails(withDetails, {
      readFiles: ["x.ts", "z.ts"],
      modifiedFiles: [],
    });
    const parsed = parseCompactFileDetails(again)!;
    expect(parsed.readFiles.sort()).toEqual(["x.ts", "z.ts"]);
    expect(parsed.modifiedFiles).toEqual(["y.ts"]);
  });
});

describe("getCompactSettings keepRecentTokens", () => {
  it("默认 20000，可配置覆盖", () => {
    expect(getCompactSettings(makeConfig()).keepRecentTokens).toBe(50);
    expect(getCompactSettings(makeConfig({ keepRecentTokens: undefined as unknown as number })).keepRecentTokens).toBe(
      DEFAULT_KEEP_RECENT_TOKENS,
    );
  });
});

describe("maybeCompactMessages 使用切割点", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spy: any;

  beforeEach(() => {
    spy = vi.spyOn(llmClient, "chatCompletion").mockResolvedValue({
      content: "压缩摘要",
      toolCalls: [],
      finishReason: "stop",
      model: "m",
      provider: "p",
    } as any);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("超阈值时按 keepRecentTokens 切，保留段不含残缺 tool 对", async () => {
    // 内容需超过 resolveCompactCharThreshold(model, 0.05)（约数万字符）
    const msgs: LlmMessage[] = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 40; i++) {
      msgs.push({ role: "user", content: `u${i}-` + "x".repeat(2000) });
      const id = `c${i}`;
      msgs.push(
        assistantWithTools([id], i % 2 === 0 ? ["read_file"] : ["write_file"], [
          { path: `f${i}.ts` },
        ]),
      );
      msgs.push(toolResult(id, "r".repeat(800)));
    }
    const result = await maybeCompactMessages(
      makeConfig({ keepRecentTokens: 400, keepRecent: 2 }),
      msgs,
      "deepseek-v4-flash",
    );
    expect(result.compacted).toBe(true);
    expect(toolPairsComplete(result.messages)).toBe(true);
    expect(result.fileDetails).toBeDefined();
    expect(
      (result.fileDetails!.readFiles.length > 0 || result.fileDetails!.modifiedFiles.length > 0),
    ).toBe(true);
  });
});
