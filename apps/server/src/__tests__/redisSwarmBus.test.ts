/**
 * RedisSwarmBus 与 Local 语义对齐 + getSwarmBus redis 同步工厂。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSwarmBus, getSwarmBus, LocalSwarmBus } from "../infra/swarmBus.js";
import { RedisSwarmBus } from "../infra/redisSwarmBus.js";

vi.mock("bullmq", () => {
  class Queue {
    add = vi.fn(async () => ({ id: "job-1" }));
    close = vi.fn(async () => {});
  }
  return { Queue };
});

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    agent: {
      findUnique: vi.fn(async () => ({
        id: "to-1",
        tier: "manager",
        workspaceId: "ws-1",
        status: "active",
      })),
    },
    agentMessage: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "msg-1",
        ...data,
      })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    chatSession: {
      findMany: vi.fn(async () => []),
    },
    log: {
      create: vi.fn(async () => ({})),
    },
    ...overrides,
  } as any;
}

describe("getSwarmBus redis factory", () => {
  const prev = process.env.SWARM_MODE;

  beforeEach(() => {
    resetSwarmBus();
  });

  afterEach(() => {
    resetSwarmBus();
    if (prev === undefined) delete process.env.SWARM_MODE;
    else process.env.SWARM_MODE = prev;
  });

  it("SWARM_MODE=redis 时首次 getSwarmBus 即为 RedisSwarmBus", () => {
    process.env.SWARM_MODE = "redis";
    const bus = getSwarmBus(mockPrisma(), {} as any);
    expect(bus).toBeInstanceOf(RedisSwarmBus);
  });

  it("SWARM_MODE=local 时为 LocalSwarmBus", () => {
    process.env.SWARM_MODE = "local";
    const bus = getSwarmBus(mockPrisma(), {} as any);
    expect(bus).toBeInstanceOf(LocalSwarmBus);
  });
});

describe("RedisSwarmBus.send", () => {
  it("report + inToolRound 允许向上发送（allowReportTool）", async () => {
    const prisma = mockPrisma({
      agent: {
        findUnique: vi.fn(async () => ({
          id: "mgr",
          tier: "manager",
          workspaceId: "ws-1",
          status: "active",
        })),
      },
    });
    const bus = new RedisSwarmBus(prisma, {} as any, undefined);
    const result = await bus.send(
      {
        fromAgentId: "sub-1",
        toAgentId: "mgr",
        content: "done",
        messageType: "report",
      },
      "sub",
      "ws-1",
      true,
    );
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg-1");
  });

  it("按目标 Agent pending 计数触发 QUEUE_FULL", async () => {
    const prisma = mockPrisma({
      agentMessage: {
        count: vi.fn(async () => 9999),
        create: vi.fn(),
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });
    const bus = new RedisSwarmBus(prisma, {} as any, undefined);
    const result = await bus.send(
      { fromAgentId: "a", toAgentId: "to-1", content: "x", messageType: "command" },
      "super",
      null,
      false,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("QUEUE_FULL");
    expect(prisma.agentMessage.create).not.toHaveBeenCalled();
  });
});
