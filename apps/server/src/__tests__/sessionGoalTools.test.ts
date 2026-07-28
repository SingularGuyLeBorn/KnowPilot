import { beforeEach, describe, expect, it, vi } from "vitest";

const setSpy = vi.fn();
const readSpy = vi.fn();
const clearSpy = vi.fn();
const pauseSpy = vi.fn();
const resumeSpy = vi.fn();

vi.mock("../infra/goalLoop.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/goalLoop.js")>();
  return {
    ...actual,
    setSessionGoal: (...args: unknown[]) => setSpy(...args),
    readGoalStateRaw: (...args: unknown[]) => readSpy(...args),
    clearSessionGoal: (...args: unknown[]) => clearSpy(...args),
    pauseSessionGoal: (...args: unknown[]) => pauseSpy(...args),
    resumeSessionGoal: (...args: unknown[]) => resumeSpy(...args),
  };
});

import { executeNativeTool } from "../infra/nativeTools.js";
import type { NativeToolContext } from "../infra/tools/native/types.js";

function makeCtx(sessionId?: string): NativeToolContext {
  return {
    config: { goal: { maxTurns: 20, deepResearchMaxTurns: 30, judgeModel: "auto" } } as never,
    services: {} as never,
    invokeTrpc: async () => ({}),
    sessionId,
  };
}

describe("session_goal_* tools", () => {
  beforeEach(() => {
    setSpy.mockReset();
    readSpy.mockReset();
    clearSpy.mockReset();
    pauseSpy.mockReset();
    resumeSpy.mockReset();
  });

  it("session_goal_set 缺 sessionId 报错", async () => {
    await expect(
      executeNativeTool("session_goal_set", { text: "修测试" }, makeCtx()),
    ).rejects.toThrow(/sessionId/);
  });

  it("session_goal_set 写入 standing goal", async () => {
    setSpy.mockResolvedValue({
      mode: "goal",
      text: "修测试",
      status: "active",
      turnsUsed: 0,
      maxTurns: 20,
      judgeModel: "auto",
    });
    const res = (await executeNativeTool(
      "session_goal_set",
      { text: "修测试" },
      makeCtx("sess1"),
    )) as { ok: boolean; summary: string; hint: string };
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess1",
        text: "修测试",
        mode: "goal",
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.hint).toMatch(/Standing goal/);
  });

  it("session_goal_status 读状态", async () => {
    readSpy.mockResolvedValue(null);
    const res = (await executeNativeTool("session_goal_status", {}, makeCtx("sess1"))) as {
      summary: string;
    };
    expect(res.summary).toMatch(/无 standing goal/);
  });
});
