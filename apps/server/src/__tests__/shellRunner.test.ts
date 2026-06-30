import { describe, it, expect, vi, afterEach } from "vitest";
import { validateShellCommand, waitMs } from "../infra/shellRunner.js";

describe("shellRunner — validateShellCommand", () => {
  it("拒绝 rm -rf /", () => {
    expect(() => validateShellCommand("rm -rf /")).toThrow(/安全策略/);
  });

  it("允许普通命令", () => {
    expect(() => validateShellCommand("pnpm test")).not.toThrow();
  });

  it("空命令抛错", () => {
    expect(() => validateShellCommand("   ")).toThrow(/不能为空/);
  });
});

describe("shellRunner — waitMs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamp 最大 300 秒", async () => {
    vi.useFakeTimers();
    const p = waitMs(999_999_999);
    await vi.advanceTimersByTimeAsync(300_000);
    const result = await p;
    expect(result.waitedMs).toBe(300_000);
  });
});
