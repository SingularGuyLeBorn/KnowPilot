import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { offloadToolResultIfNeeded } from "../infra/toolResultOffload.js";
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

  it("超阈值落盘并返回路径预览", () => {
    const config = createTestConfig(root);
    const big = { content: "x".repeat(5000), title: "t" };
    const off = offloadToolResultIfNeeded(config, big, {
      sessionId: "sess1",
      toolCallId: "call-1",
      toolName: "read_article",
      thresholdChars: 1000,
    });
    expect(off).not.toBeNull();
    expect(off!.llmResult.offloaded).toBe(true);
    expect(off!.llmResult.path).toMatch(/tool-results/);
    expect(fs.existsSync(path.join(root, off!.llmResult.path))).toBe(true);
    expect(off!.llmResult.suggestedTool).toBe("read_file");
  });

  it("未超阈值不落盘", () => {
    const config = createTestConfig(root);
    const off = offloadToolResultIfNeeded(config, { content: "hi" }, {
      toolCallId: "c",
      toolName: "x",
      thresholdChars: 4000,
    });
    expect(off).toBeNull();
  });
});
