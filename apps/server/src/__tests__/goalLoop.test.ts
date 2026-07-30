import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseJudgeOutput,
  parseGoalState,
  parseLeadingGoalDirective,
  evaluateGoalAfterTurn,
  drainGoalContinueAfterSettle,
  buildGoalKickoffMessage,
  setSessionGoal,
  __resetGoalLoopHookForTests,
  __setGoalStateStoreForTests,
} from "../infra/goalLoop.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";
import type { SessionGoalState } from "@knowpilot/shared";

describe("goalLoop", () => {
  let mem: Map<string, SessionGoalState | null>;

  it("parseLeadingGoalDirective：识别 /goal 与控制子命令", () => {
    expect(parseLeadingGoalDirective("普通任务")).toEqual({
      goalText: null,
      message: "普通任务",
    });
    expect(parseLeadingGoalDirective("/goal 完成入库并报告")).toEqual({
      goalText: "完成入库并报告",
      message: "完成入库并报告",
    });
    expect(parseLeadingGoalDirective("/goal pause").goalText).toBeNull();
    expect(parseLeadingGoalDirective("/goal status").goalText).toBeNull();
  });

  beforeEach(() => {
    __resetGoalLoopHookForTests();
    mem = new Map();
    __setGoalStateStoreForTests({
      read: async (id) => mem.get(id) ?? null,
      write: async (id, g) => {
        mem.set(id, g);
      },
    });
  });

  it("parseJudgeOutput 解析 JSON；失败返回 null", () => {
    expect(parseJudgeOutput('{"done": true, "reason": "ok"}')).toEqual({
      done: true,
      reason: "ok",
    });
    expect(parseJudgeOutput("not json")).toBeNull();
  });

  it("deep_research kickoff 含调研提示", () => {
    const msg = buildGoalKickoffMessage({
      mode: "deep_research",
      text: "调研 X",
      status: "active",
      turnsUsed: 0,
      maxTurns: 30,
      judgeModel: "auto",
    });
    expect(msg).toContain("深度调研");
    expect(msg).toContain("调研 X");
  });

  it("evaluateGoalAfterTurn：pause 后 skip", async () => {
    mem.set("s1", {
      mode: "goal",
      text: "fix tests",
      status: "paused",
      turnsUsed: 1,
      maxTurns: 20,
      judgeModel: "auto",
    });
    const res = await evaluateGoalAfterTurn({
      services: {} as never,
      config: createTestConfig("/tmp/goal"),
      sessionId: "s1",
      lastAssistantText: "done",
      mainModel: "deepseek-chat",
    });
    expect(res.action).toBe("skip");
  });

  it("evaluateGoalAfterTurn：裁判 continue → pendingContinue；失败 fail-open", async () => {
    mem.set("s1", {
      mode: "goal",
      text: "fix tests",
      status: "active",
      turnsUsed: 0,
      maxTurns: 20,
      judgeModel: "auto",
    });
    const cont = await evaluateGoalAfterTurn({
      services: {} as never,
      config: createTestConfig("/tmp/goal"),
      sessionId: "s1",
      lastAssistantText: "still working",
      mainModel: "deepseek-chat",
      judgeFn: async () => ({ done: false, reason: "3 files remain" }),
    });
    expect(cont.action).toBe("continue");
    expect(mem.get("s1")?.pendingContinue?.reason).toBe("3 files remain");

    mem.set("s1", {
      mode: "goal",
      text: "fix tests",
      status: "active",
      turnsUsed: 1,
      maxTurns: 20,
      judgeModel: "auto",
    });
    const failOpen = await evaluateGoalAfterTurn({
      services: {} as never,
      config: createTestConfig("/tmp/goal"),
      sessionId: "s1",
      lastAssistantText: "x",
      mainModel: "deepseek-chat",
      judgeFn: async () => {
        throw new Error("network");
      },
    });
    expect(failOpen.action).toBe("continue");
    expect(mem.get("s1")?.pendingContinue?.reason).toMatch(/Judge error/);
  });

  it("evaluateGoalAfterTurn：预算耗尽 → exhausted，不再 continue", async () => {
    mem.set("s1", {
      mode: "goal",
      text: "fix",
      status: "active",
      turnsUsed: 19,
      maxTurns: 20,
      judgeModel: "auto",
    });
    const res = await evaluateGoalAfterTurn({
      services: {} as never,
      config: createTestConfig("/tmp/goal"),
      sessionId: "s1",
      lastAssistantText: "almost",
      mainModel: "m",
      judgeFn: async () => ({ done: false, reason: "more" }),
    });
    expect(res.action).toBe("exhausted");
    expect(mem.get("s1")?.status).toBe("exhausted");
    expect(mem.get("s1")?.pendingContinue).toBeNull();
  });

  it("drainGoalContinueAfterSettle：有 pending 则清标记并 startContinuation", async () => {
    mem.set("s1", {
      mode: "goal",
      text: "fix",
      status: "active",
      turnsUsed: 2,
      maxTurns: 20,
      judgeModel: "auto",
      pendingContinue: { reason: "keep going" },
    });
    const startContinuation = vi.fn(async () => true);
    const services = {
      session: {
        getByIdLite: vi.fn(async () => ({
          model: "deepseek-chat",
          agentId: "a1",
        })),
      },
    };
    const ok = await drainGoalContinueAfterSettle({
      services: services as never,
      config: createTestConfig("/tmp/goal"),
      sessionId: "s1",
      startContinuation,
    });
    expect(ok).toBe(true);
    expect(startContinuation).toHaveBeenCalledOnce();
    expect(mem.get("s1")?.pendingContinue).toBeNull();
  });

  it("setSessionGoal：deep_research 用更高 maxTurns 默认", async () => {
    const goal = await setSessionGoal({
      services: {
        session: {
          getByIdLite: vi.fn(async () => ({
            id: "s1",
            kind: "chat",
            parentSessionId: null,
          })),
          update: vi.fn(),
        },
        message: { list: vi.fn(async () => ({ items: [] })) },
      } as never,
      config: createTestConfig("/tmp/goal", {
        goal: { maxTurns: 20, deepResearchMaxTurns: 30, judgeModel: "auto" },
      }),
      sessionId: "s1",
      text: "调研主题",
      mode: "deep_research",
    });
    expect(goal.mode).toBe("deep_research");
    expect(goal.maxTurns).toBe(30);
    expect(mem.get("s1")?.mode).toBe("deep_research");
  });

  it("setSessionGoal：子会话允许 goal，拒绝 deep_research", async () => {
    const goal = await setSessionGoal({
      services: {
        session: {
          getByIdLite: vi.fn(async () => ({
            id: "sub1",
            kind: "subagent",
            parentSessionId: "parent1",
          })),
          update: vi.fn(),
        },
      } as never,
      config: createTestConfig("/tmp/goal", {
        goal: { maxTurns: 20, deepResearchMaxTurns: 30, judgeModel: "auto" },
      }),
      sessionId: "sub1",
      text: "完成调研并 report_back",
      mode: "goal",
    });
    expect(goal.mode).toBe("goal");
    expect(mem.get("sub1")?.text).toMatch(/report_back/);

    await expect(
      setSessionGoal({
        services: {
          session: {
            getByIdLite: vi.fn(async () => ({
              id: "sub1",
              kind: "subagent",
              parentSessionId: "parent1",
            })),
          },
        } as never,
        config: createTestConfig("/tmp/goal"),
        sessionId: "sub1",
        text: "深度调研",
        mode: "deep_research",
      }),
    ).rejects.toThrow(/深度调研/);
  });

  it("setSessionGoal：deep_research 已有用户消息时拒绝", async () => {
    await expect(
      setSessionGoal({
        services: {
          session: {
            getByIdLite: vi.fn(async () => ({
              id: "s1",
              kind: "chat",
              parentSessionId: null,
            })),
          },
          message: {
            list: vi.fn(async () => ({
              items: [{ role: "user", source: "user", content: "你好" }],
            })),
          },
        } as never,
        config: createTestConfig("/tmp/goal"),
        sessionId: "s1",
        text: "调研",
        mode: "deep_research",
      }),
    ).rejects.toThrow(/第一条消息之前/);
  });
});
