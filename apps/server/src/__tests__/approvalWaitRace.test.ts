/**
 * C3：审批等待注册表 missed-wakeup + TTL 误报 + expireStaleApprovals 误 notify
 *
 * 负向断言（旧实现红 → 修复后绿）：
 * 1. 决策落在「读 pending 之后、注册之前」窗口 → 不得挂到 TTL，须立即 resolve 真实结果
 * 2. TTL 到期时条件写 count=0（已被并发批准）→ 不得误报 expired
 * 3. expireStaleApprovals 对条件写未翻转的行不发 notify
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  waitApprovalResolution,
  notifyApprovalResolved,
  expireStaleApprovals,
  __resetApprovalWaitersForTests,
} from "../infra/approvalGate.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";

function makeServices(overrides: {
  getById?: (id: string) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<{ count: number }>;
  findMany?: (args: unknown) => Promise<unknown[]>;
}): ServiceContainer {
  return {
    approval: {
      getById: overrides.getById ?? (async () => ({ status: "pending", toolName: "git_commit" })),
    },
    prisma: {
      approval: {
        updateMany: overrides.updateMany ?? (async () => ({ count: 0 })),
        findMany: overrides.findMany ?? (async () => []),
      },
    },
  } as unknown as ServiceContainer;
}

describe("C3 approval wait 竞态", () => {
  beforeEach(() => {
    __resetApprovalWaitersForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    __resetApprovalWaitersForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("决策落在读 pending 与注册之间 → 立即 resolve approved（不得挂到 TTL）", async () => {
    let releaseRead!: (v: unknown) => void;
    const readGate = new Promise<unknown>((r) => {
      releaseRead = r;
    });
    const getById = vi.fn().mockReturnValue(readGate);
    const services = makeServices({ getById });

    const waitP = waitApprovalResolution(services, "appr-miss");
    await vi.waitFor(() => expect(getById).toHaveBeenCalled());

    // 复读 await 窗口内决策落地：注册先行后必达
    notifyApprovalResolved("appr-miss", {
      outcome: "approved",
      approvalId: "appr-miss",
      toolName: "git_commit",
      execResult: { ok: true },
    });

    releaseRead({
      toolName: "git_commit",
      status: "pending",
      createdAt: new Date(),
    });

    await expect(waitP).resolves.toMatchObject({
      outcome: "approved",
      approvalId: "appr-miss",
      toolName: "git_commit",
    });
  });

  it("TTL 到期时条件写 count=0（并发已批准）→ resolve approved 而非 expired", async () => {
    vi.stubEnv("APPROVAL_PENDING_TTL_MS", "50");
    const createdAt = new Date(Date.now() - 1000);
    let getByIdCalls = 0;
    const getById = vi.fn(async () => {
      getByIdCalls += 1;
      if (getByIdCalls === 1) {
        return { toolName: "git_commit", status: "pending", createdAt };
      }
      return {
        toolName: "git_commit",
        status: "executed",
        decidedBy: "local-user",
        createdAt,
      };
    });
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const services = makeServices({ getById, updateMany });

    const resolution = await waitApprovalResolution(services, "appr-ttl");
    expect(resolution.outcome).toBe("approved");
    expect(resolution.approvalId).toBe("appr-ttl");
    expect(updateMany).toHaveBeenCalled();
  });

  it("expireStaleApprovals 只对实际翻转成功的行发 notify", async () => {
    vi.stubEnv("APPROVAL_PENDING_TTL_MS", "60000");
    const findMany = vi.fn(async () => [
      { id: "flip-ok", toolName: "git_commit" },
      { id: "flip-no", toolName: "git_push" },
    ]);
    const updateMany = vi.fn(async (args: { where?: { id?: string } }) => ({
      count: args?.where?.id === "flip-ok" ? 1 : 0,
    }));
    const getById = vi.fn(async (id: string) => ({
      toolName: id === "flip-ok" ? "git_commit" : "git_push",
      status: "pending",
      createdAt: new Date(),
    }));
    const services = makeServices({ findMany, updateMany, getById });

    const waitOk = waitApprovalResolution(services, "flip-ok");
    const waitNo = waitApprovalResolution(services, "flip-no");
    await new Promise((r) => setTimeout(r, 20));

    const n = await expireStaleApprovals(services);
    expect(n).toBe(1);
    await expect(waitOk).resolves.toMatchObject({ outcome: "expired", approvalId: "flip-ok" });

    let noSettled = false;
    void waitNo.then(() => {
      noSettled = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(noSettled).toBe(false);

    notifyApprovalResolved("flip-no", {
      outcome: "rejected",
      approvalId: "flip-no",
      toolName: "git_push",
    });
    await waitNo;
  });
});
