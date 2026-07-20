/**
 * W3：审批 decision-scope 派生 / 匹配 / 调度相交 / safe bypass / 通知冷却
 *
 * 负向断言：旧实现无 scope → 调度全堵或全放、冷却不生效、safe bypass 无限放行。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveDecisionScope,
  deriveRequiredScopesFromTools,
  directoryPrefixForWrite,
  filterReadonlyTools,
  findGateBlock,
  getCachedPendingApprovalScopes,
  scopesIntersect,
  scopesMatch,
  setCachedPendingApprovalScopes,
  shouldNotifyApprovalByCooldown,
  __resetPendingScopeCacheForTests,
} from "../infra/approvalScope.js";
import {
  AsyncJobOrchestrator,
  resetAsyncJobOrchestratorForTests,
} from "../infra/asyncJobOrchestrator.js";
import { registerTool, __resetToolRegistryForTests } from "../infra/tools/registry.js";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("approvalScope 派生", () => {
  it("git / fs / agent / memory / post 各 destructive args → 预期 scope", () => {
    expect(deriveDecisionScope("git_commit", { repoId: "r1", message: "x" })).toBe("git:commit:r1");
    expect(deriveDecisionScope("git.push", { repoId: "r2" })).toBe("git:push:r2");
    expect(deriveDecisionScope("write_file", { path: "docs/a/b.md", content: "x" })).toBe(
      "fs:write:docs/a",
    );
    expect(deriveDecisionScope("file_delete", { path: "tmp/x.txt" })).toBe("fs:delete:tmp/x.txt");
    expect(deriveDecisionScope("agent_delete", { id: "ag1" })).toBe("agent:delete:ag1");
    expect(deriveDecisionScope("memory.delete", { id: "m1" })).toBe("memory:delete:m1");
    expect(deriveDecisionScope("post_delete", { id: "p1" })).toBe("post:delete:p1");
  });

  it("缺省回退 tool:<toolName>", () => {
    expect(deriveDecisionScope("unknown_destructive_op", { foo: 1 })).toBe(
      "tool:unknown_destructive_op",
    );
  });

  it("fs:write 目录级前缀（文件取父目录）", () => {
    expect(directoryPrefixForWrite("a/b/c.txt")).toBe("a/b");
    expect(directoryPrefixForWrite("root.md")).toBe(".");
    expect(directoryPrefixForWrite("content/posts")).toBe("content/posts");
  });
});

describe("approvalScope 匹配", () => {
  it("通配 / 精确 / 不相交三态", () => {
    expect(scopesMatch("fs:write:*", "fs:write:/a")).toBe(true);
    expect(scopesMatch("fs:write:/a", "fs:write:*")).toBe(true);
    expect(scopesMatch("git:*", "git:commit:r1")).toBe(true);
    expect(scopesMatch("git:commit:r1", "git:commit:r1")).toBe(true);
    expect(scopesMatch("fs:write:/a", "fs:delete:/a")).toBe(false);
    expect(scopesMatch("git:commit:r1", "git:push:r1")).toBe(false);
    expect(scopesIntersect(["fs:write:*"], ["fs:write:docs"])).toBe(true);
    expect(scopesIntersect(["memory:delete:*"], ["fs:write:docs"])).toBe(false);
  });
});

describe("approvalScope 工作项 requiredScopes", () => {
  it("声明 write_file → fs:write:*；git_commit → git 族", () => {
    const scopes = deriveRequiredScopesFromTools(["write_file", "git_commit", "memory_search"]);
    expect(scopes).toContain("fs:write:*");
    expect(scopes).toContain("git:commit:*");
    expect(scopes).toContain("git:*");
    expect(scopes).not.toContain("tool:memory_search");
  });
});

describe("调度：pending scope 相交 → 准入被拒 / 不相交放行", () => {
  afterEach(() => {
    resetAsyncJobOrchestratorForTests();
    __resetPendingScopeCacheForTests();
  });

  it("pending fs:write:/a 时 requiredScopes 含 fs:write:* 被拒，不含的放行", async () => {
    setCachedPendingApprovalScopes([{ approvalId: "ap1", scope: "fs:write:/a" }]);
    const orch = new AsyncJobOrchestrator({
      maxGlobal: 2,
      maxPerSession: 5,
      taskTimeoutMs: 500,
    });

    const started: string[] = [];
    const g = new Promise<void>(() => {});
    orch.enqueue({
      jobId: "blocked",
      sessionId: "s1",
      requiredScopes: ["fs:write:*"],
      execute: async () => {
        started.push("blocked");
        await g;
      },
    });
    orch.enqueue({
      jobId: "free",
      sessionId: "s2",
      requiredScopes: ["memory:delete:*"],
      execute: async () => {
        started.push("free");
      },
    });
    await tick(40);

    // 负向：旧实现无 gate 检查 → blocked 也会 start；或全堵则 free 也不 start
    expect(orch.isQueued("blocked")).toBe(true);
    expect(orch.getQueuedReason("blocked")).toBe("gate");
    expect(orch.getGateBlock("blocked")?.approvalId).toBe("ap1");
    expect(orch.isRunning("free") || started.includes("free")).toBe(true);
    expect(started).not.toContain("blocked");
  });
});

describe("通知冷却", () => {
  it("窗口内第二次通知被抑制", () => {
    const now = Date.parse("2026-07-21T00:30:00.000Z");
    const last = "2026-07-21T00:10:00.000Z";
    expect(
      shouldNotifyApprovalByCooldown({
        lastNotifiedAt: null,
        cooldownMs: 30 * 60_000,
        nowMs: now,
      }),
    ).toBe(true);
    expect(
      shouldNotifyApprovalByCooldown({
        lastNotifiedAt: last,
        cooldownMs: 30 * 60_000,
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      shouldNotifyApprovalByCooldown({
        lastNotifiedAt: last,
        cooldownMs: 30 * 60_000,
        nowMs: Date.parse("2026-07-21T00:45:00.000Z"),
      }),
    ).toBe(true);
  });
});

describe("safe bypass：同 gate 只放行一次 readonly turn", () => {
  beforeEach(() => {
    __resetToolRegistryForTests();
    registerTool({
      name: "memory_search",
      kind: "native",
      reentrant: true,
      schema: () => ({ description: "r", parameters: {} }),
      execute: async () => ({}),
    });
    registerTool({
      name: "write_file",
      kind: "native",
      destructive: true,
      reentrant: false,
      schema: () => ({ description: "w", parameters: {} }),
      execute: async () => ({}),
    });
  });

  afterEach(() => {
    __resetToolRegistryForTests();
  });

  it("filterReadonlyTools 只留 reentrant；写工具被滤掉", () => {
    const filtered = filterReadonlyTools(["memory_search", "write_file", "read_file"]);
    expect(filtered).toContain("memory_search");
    expect(filtered).not.toContain("write_file");
  });

  it("heartbeatDecision：同 gate safeBypass 只用一次", async () => {
    const { buildHeartbeatDecision, emptyDecisionState } = await import(
      "../infra/heartbeatDecision.js"
    );
    const base = {
      enabled: true,
      goal: "巡检",
      openApprovals: 1,
      pendingAskUser: 0,
      openApprovalSummary: "待批 write_file",
      pendingApprovalScopes: [{ approvalId: "ap1", scope: "fs:write:docs" }],
      agentRequiredScopes: ["fs:write:*"],
      queuedItems: 0,
      lastRunId: null,
      lastRunAt: "2026-07-20T00:00:00.000Z",
      consecutiveFailures: 0,
      lastRunProductive: false,
      budgetExceeded: false,
      lastUserMessageAtBucket: null,
      decisionState: emptyDecisionState(),
      quietCap: 8,
      terminalAfterQuiet: 3,
      nowIso: "2026-07-21T00:00:00.000Z",
    };

    const d1 = buildHeartbeatDecision(base);
    expect(d1.mode).toBe("wait_user_gate");
    expect(d1.safeBypassAllowed).toBe(true);
    expect(d1.blockedScopes).toContain("fs:write:docs");

    const d2 = buildHeartbeatDecision({
      ...base,
      decisionState: {
        ...d1.nextState,
        safeBypassUsed: true,
        // 必须与决策层生成的 gateKey 对齐（scope 清单），否则视为新 gate 再放行一次
        safeBypassGateKey: d1.nextState.safeBypassGateKey,
      },
    });
    expect(d2.mode).toBe("wait_user_gate");
    // 负向：旧实现无 safeBypassUsed → 第二次仍 allowed
    expect(d2.safeBypassAllowed).toBe(false);
  });

  it("gate 不相交且有队列 → bounded_delivery（其余推进）", async () => {
    const { buildHeartbeatDecision, emptyDecisionState } = await import(
      "../infra/heartbeatDecision.js"
    );
    const d = buildHeartbeatDecision({
      enabled: true,
      goal: "巡检",
      openApprovals: 1,
      pendingAskUser: 0,
      openApprovalSummary: "待批 write_file",
      pendingApprovalScopes: [{ approvalId: "ap1", scope: "fs:write:docs" }],
      agentRequiredScopes: ["memory:delete:*"],
      queuedItems: 2,
      lastRunId: "r1",
      lastRunAt: "2026-07-20T00:00:00.000Z",
      consecutiveFailures: 0,
      lastRunProductive: true,
      budgetExceeded: false,
      lastUserMessageAtBucket: null,
      decisionState: emptyDecisionState(),
      quietCap: 8,
      terminalAfterQuiet: 3,
      nowIso: "2026-07-21T00:00:00.000Z",
    });
    expect(d.mode).toBe("bounded_delivery");
    expect(d.reasons.some((r) => r.includes("gate 仅阻塞") || r.includes("其余推进"))).toBe(true);
  });
});

describe("缓存辅助", () => {
  afterEach(() => {
    __resetPendingScopeCacheForTests();
  });

  it("set/get cached pending scopes", () => {
    setCachedPendingApprovalScopes([{ approvalId: "a", scope: "git:commit:x" }]);
    expect(getCachedPendingApprovalScopes()).toEqual([{ approvalId: "a", scope: "git:commit:x" }]);
    const block = findGateBlock(["git:*"], getCachedPendingApprovalScopes());
    expect(block?.approvalId).toBe("a");
  });
});
