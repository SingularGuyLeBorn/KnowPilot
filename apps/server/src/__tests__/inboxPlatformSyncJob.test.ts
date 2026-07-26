import { describe, expect, it, beforeEach } from "vitest";
import {
  computeStepItemPercent,
  getLatestInboxPlatformSyncJob,
  getActiveInboxPlatformSyncJob,
  cancelInboxPlatformSyncJob,
  __resetInboxPlatformSyncJobsForTests,
  __seedInboxPlatformSyncJobForTests,
} from "../infra/inboxPlatformSyncJob.js";

describe("computeStepItemPercent", () => {
  beforeEach(() => {
    __resetInboxPlatformSyncJobsForTests();
  });

  it("running 且 total 未知 → 0%", () => {
    expect(computeStepItemPercent({ total: 0, done: 0, status: "running" })).toBe(0);
  });

  it("list 100 成功 40 → 40%", () => {
    expect(computeStepItemPercent({ total: 100, done: 40, status: "running" })).toBe(40);
  });

  it("全部成功 → 100%", () => {
    expect(computeStepItemPercent({ total: 50, done: 50, status: "done" })).toBe(100);
  });

  it("空列表终态 → 100%", () => {
    expect(computeStepItemPercent({ total: 0, done: 0, status: "done" })).toBe(100);
  });

  it("skipped → 0%", () => {
    expect(computeStepItemPercent({ total: 0, done: 0, status: "skipped" })).toBe(0);
  });
});

describe("getLatestInboxPlatformSyncJob", () => {
  beforeEach(() => {
    __resetInboxPlatformSyncJobsForTests();
  });

  it("无任务 → null", () => {
    expect(getLatestInboxPlatformSyncJob()).toBeNull();
    expect(getActiveInboxPlatformSyncJob()).toBeNull();
  });

  it("进行中优先于更早的已结束任务", () => {
    __seedInboxPlatformSyncJobForTests({
      id: "old",
      status: "done",
      mode: "full",
      steps: [],
      startedAt: 1,
      finishedAt: 2,
    });
    __seedInboxPlatformSyncJobForTests({
      id: "run",
      status: "running",
      mode: "incremental",
      steps: [],
      startedAt: 10,
      active: true,
    });
    const latest = getLatestInboxPlatformSyncJob();
    expect(latest?.id).toBe("run");
    expect(getActiveInboxPlatformSyncJob()?.id).toBe("run");
  });

  it("cancel 给 running 任务打停止标记（message=正在停止）", () => {
    __seedInboxPlatformSyncJobForTests({
      id: "run-cancel",
      status: "running",
      mode: "full",
      steps: [
        {
          key: "zhihu",
          label: "知乎收藏夹",
          status: "running",
          total: 100,
          done: 10,
          message: "拉取中",
        },
      ],
      startedAt: 1,
      active: true,
    });
    const snapped = cancelInboxPlatformSyncJob("run-cancel");
    expect(snapped.status).toBe("running");
    expect(snapped.steps[0]?.message).toBe("正在停止…");
  });
});
