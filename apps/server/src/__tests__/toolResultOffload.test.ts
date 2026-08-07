import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  KP_META_PATH_KEY,
  KP_RESULT_PATH_KEY,
  cleanupExpiredToolResults,
  listToolResultIndex,
  offloadToolResultIfNeeded,
  readToolResultMeta,
} from "../infra/toolResultOffload.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

describe("toolResultOffload", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kp-offload-"));
    fs.mkdirSync(path.join(root, "data", "tool-results"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("超阈值落盘并返回 metadata 索引卡（无 preview 正文）", () => {
    const config = createTestConfig(root);
    const big = { content: "x".repeat(5000), title: "t" };
    const off = offloadToolResultIfNeeded(config, big, {
      sessionId: "sess1",
      toolCallId: "call-1",
      toolName: "read_article",
      thresholdChars: 1000,
    });
    expect(off).not.toBeNull();
    expect(off!.compacted).toBe(true);
    expect(fs.existsSync(path.join(root, off!.path))).toBe(true);
    expect(fs.existsSync(path.join(root, off!.metaPath))).toBe(true);
    const card = off!.llmResult as {
      offloaded: boolean;
      preview?: string;
      metadata: { contentType: string; title?: string };
      keywords: string[];
    };
    expect(card.offloaded).toBe(true);
    expect(card.preview).toBeUndefined();
    expect(card.metadata.contentType).toBeTruthy();
    expect(JSON.stringify(card)).not.toContain("x".repeat(200));
  });

  it("未超阈值也落盘+meta，LLM 仍拿原文并带 path 注解", () => {
    const config = createTestConfig(root);
    const off = offloadToolResultIfNeeded(config, { content: "hi", title: "t" }, {
      sessionId: "sess-small",
      toolCallId: "c-small",
      toolName: "x",
      thresholdChars: 4000,
    });
    expect(off).not.toBeNull();
    expect(off!.compacted).toBe(false);
    expect(fs.existsSync(path.join(root, off!.path))).toBe(true);
    expect(fs.existsSync(path.join(root, off!.metaPath))).toBe(true);
    const llm = off!.llmResult as Record<string, unknown>;
    expect(llm.content).toBe("hi");
    expect(llm[KP_RESULT_PATH_KEY]).toBe(off!.path);
    expect(llm[KP_META_PATH_KEY]).toBe(off!.metaPath);
    const index = listToolResultIndex(config, "sess-small");
    expect(index).toHaveLength(1);
    expect(index[0]!.contentType).toBeTruthy();
    expect(index[0]!.hitCount).toBe(0);
  });

  it("带 expect_keywords 时索引卡含 hitOffsets，正文只在落盘文件", () => {
    const config = createTestConfig(root);
    const needle = "CRITICAL_SIGNAL_TORCH_COMPILE";
    const content =
      "noise ".repeat(800) +
      `Here is ${needle} with important detail 42%. ` +
      "noise ".repeat(800);
    const off = offloadToolResultIfNeeded(
      config,
      { content, title: "release notes", url: "https://example.com/rel" },
      {
        sessionId: "sess-kw",
        toolCallId: "call-kw",
        toolName: "read_article",
        thresholdChars: 500,
        expectKeywords: [needle, "missing-word"],
        expectPatterns: [String.raw`\d+%`],
        contextWindow: 60,
      },
    );
    expect(off).not.toBeNull();
    expect(off!.compacted).toBe(true);
    const card = off!.llmResult as {
      hitCount: number;
      missedKeywords: string[];
      metadata: {
        hitOffsets: Array<{ keyword: string; start: number }>;
        recommendedRead: Array<{ offset: number; reason: string }>;
        contentType: string;
      };
      path: string;
    };
    expect(card.hitCount).toBeGreaterThanOrEqual(1);
    expect(card.missedKeywords).toContain("missing-word");
    expect(card.metadata.hitOffsets.some((h) => h.keyword.includes(needle))).toBe(true);
    expect(card.metadata.recommendedRead[0]?.reason).toMatch(/keyword/);
    expect(card.metadata.contentType).toBe("web_page");
    expect(JSON.stringify(card)).not.toContain("important detail 42%");
    const raw = fs.readFileSync(path.join(root, card.path), "utf8");
    expect(raw).toContain(needle);
    const index = listToolResultIndex(config, "sess-kw");
    expect(index[0]!.topics.length).toBeGreaterThan(0);
    expect(index[0]!.hitCount).toBeGreaterThanOrEqual(1);
  });

  it("同 toolCallId 冲突时改名落盘，不覆盖旧文件", () => {
    const config = createTestConfig(root);
    const a = offloadToolResultIfNeeded(config, { content: "first-" + "a".repeat(50) }, {
      sessionId: "sess-collide",
      toolCallId: "same-id",
      toolName: "t",
      thresholdChars: 10_000,
    });
    const b = offloadToolResultIfNeeded(config, { content: "second-" + "b".repeat(50) }, {
      sessionId: "sess-collide",
      toolCallId: "same-id",
      toolName: "t",
      thresholdChars: 10_000,
    });
    expect(a!.path).not.toBe(b!.path);
    expect(fs.existsSync(path.join(root, a!.path))).toBe(true);
    expect(fs.existsSync(path.join(root, b!.path))).toBe(true);
    expect(fs.readFileSync(path.join(root, a!.path), "utf8")).toContain("first-");
    expect(fs.readFileSync(path.join(root, b!.path), "utf8")).toContain("second-");
    expect(listToolResultIndex(config, "sess-collide")).toHaveLength(2);
  });

  it("readToolResultMeta 可查厚 metadata，且拒绝越界路径", () => {
    const config = createTestConfig(root);
    const off = offloadToolResultIfNeeded(config, { content: "meta-body", title: "T" }, {
      sessionId: "sess-meta",
      toolCallId: "c-meta",
      toolName: "x",
      thresholdChars: 4000,
    });
    const meta = readToolResultMeta(config, off!.metaPath);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe("T");
    expect(() => readToolResultMeta(config, "config/agents/assistant.md")).toThrow(/tool-results/);
  });

  it("TTL cleanup 删除过期文件并重写 index，list 跳过孤儿行", () => {
    const config = createTestConfig(root);
    const off = offloadToolResultIfNeeded(config, { content: "old-payload" }, {
      sessionId: "sess-ttl",
      toolCallId: "c-ttl",
      toolName: "x",
      thresholdChars: 4000,
    });
    const abs = path.join(root, off!.path);
    const metaAbs = path.join(root, off!.metaPath);
    const past = Date.now() - 20 * 24 * 60 * 60 * 1000;
    fs.utimesSync(abs, new Date(past), new Date(past));
    fs.utimesSync(metaAbs, new Date(past), new Date(past));

    const cleaned = cleanupExpiredToolResults(config, { retentionDays: 14, now: Date.now() });
    expect(cleaned.removedFiles).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(abs)).toBe(false);
    expect(listToolResultIndex(config, "sess-ttl")).toHaveLength(0);
  });
});
