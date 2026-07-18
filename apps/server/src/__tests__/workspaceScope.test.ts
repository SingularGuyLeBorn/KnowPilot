import { describe, it, expect } from "vitest";
import {
  checkCrossWorkspace,
  checkWorkspaceAgentAccess,
  checkToolPermission,
  getAllowedToolsForTier,
} from "../infra/swarmPermissionGuard.js";
import { AsyncJobOrchestrator, resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { afterEach } from "vitest";

describe("Workspace 出域硬拦（Q3）", () => {
  it("管理 Agent 可向超级报告（即使超级在 Root Workspace）", () => {
    expect(
      checkCrossWorkspace("manager", "ws-biz", "ws-root", { toTier: "super" }),
    ).toBeNull();
  });

  it("管理 Agent 不能向其他业务 Workspace 的 manager 发消息", () => {
    const err = checkCrossWorkspace("manager", "ws-a", "ws-b", { toTier: "manager" });
    expect(err?.code).toBe("CROSS_WORKSPACE_FORBIDDEN");
  });

  it("同 Workspace 放行", () => {
    expect(checkCrossWorkspace("manager", "ws-a", "ws-a", { toTier: "sub" })).toBeNull();
  });

  it("管理 Agent 不能 update/delete 跨空间 Agent", () => {
    const err = checkWorkspaceAgentAccess(
      { tier: "manager", workspaceId: "ws-a" },
      { tier: "sub", workspaceId: "ws-b", id: "ag-1" },
      "agent_update",
    );
    expect(err?.code).toBe("CROSS_WORKSPACE_FORBIDDEN");
  });

  it("管理 Agent 不能操作超级 Agent（CRUD）", () => {
    const err = checkWorkspaceAgentAccess(
      { tier: "manager", workspaceId: "ws-a" },
      { tier: "super", workspaceId: "ws-root", id: "super-1" },
      "agent_delete",
    );
    expect(err?.code).toBe("TIER_PROTECTED");
  });

  it("manager 可用 agent_update（tier 门槛）", () => {
    expect(
      checkToolPermission("agent_update", { id: "x" }, {
        agentTier: "manager",
        agentId: "m1",
        agentWorkspaceId: "ws-a",
        inToolRound: true,
      }),
    ).toBeNull();
  });

  it("sub 不能用 agent_update", () => {
    const err = checkToolPermission("agent_update", { id: "x" }, {
      agentTier: "sub",
      agentId: "s1",
      agentWorkspaceId: "ws-a",
      inToolRound: true,
    });
    expect(err?.code).toBe("TIER_INSUFFICIENT");
  });

  it("free_api_keys_* / free_models_list 仅 manager 及以上：sub 硬拦，manager/super 放行", () => {
    for (const tool of ["free_api_keys_list", "free_api_keys_fetch", "free_models_list"] as const) {
      expect(
        checkToolPermission(tool, {}, {
          agentTier: "sub",
          agentId: "s1",
          agentWorkspaceId: "ws-a",
          inToolRound: true,
        })?.code,
      ).toBe("TIER_INSUFFICIENT");
      expect(
        checkToolPermission(tool, {}, {
          agentTier: "manager",
          agentId: "m1",
          agentWorkspaceId: "ws-a",
          inToolRound: true,
        }),
      ).toBeNull();
      expect(
        checkToolPermission(tool, {}, {
          agentTier: "super",
          agentId: "sup1",
          agentWorkspaceId: null,
          inToolRound: true,
        }),
      ).toBeNull();
    }
  });

  it("getAllowedToolsForTier 从 sub 清单剔除 free_api_keys_* / free_models_list", () => {
    const filtered = getAllowedToolsForTier("sub", [
      "native:free_api_keys_list",
      "native:free_api_keys_fetch",
      "native:free_models_list",
      "native:web_search",
    ]);
    expect(filtered).toEqual(["native:web_search"]);
    expect(
      getAllowedToolsForTier("manager", [
        "native:free_api_keys_list",
        "native:free_models_list",
        "native:web_search",
      ]),
    ).toEqual(["native:free_api_keys_list", "native:free_models_list", "native:web_search"]);
  });
});

describe("Workspace 行级异步槽（Q4）", () => {
  afterEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  it("workspaceSlotQuota=1 时同空间第二个 llm 任务排队；lightweight 不受限", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 10, maxPerSession: 10, taskTimeoutMs: 60_000 });
    const gate = { open: false };
    const started: string[] = [];

    orch.enqueue({
      jobId: "a",
      sessionId: "s1",
      workspaceId: "ws-1",
      workspaceSlotQuota: 1,
      slotClass: "llm",
      execute: async () => {
        started.push("a");
        while (!gate.open) await new Promise((r) => setTimeout(r, 15));
      },
    });
    orch.enqueue({
      jobId: "b",
      sessionId: "s1",
      workspaceId: "ws-1",
      workspaceSlotQuota: 1,
      slotClass: "llm",
      execute: async () => {
        started.push("b");
      },
    });
    orch.enqueue({
      jobId: "sleep",
      sessionId: "s1",
      workspaceId: "ws-1",
      workspaceSlotQuota: 1,
      slotClass: "lightweight",
      execute: async () => {
        started.push("sleep");
      },
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(started).toContain("a");
    expect(started).toContain("sleep");
    expect(started).not.toContain("b");

    gate.open = true;
    await new Promise((r) => setTimeout(r, 60));
    expect(started).toContain("b");
  });
});
