import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { prisma } from "../db.js";
import { initSwarm } from "../infra/swarmInitializer.js";

describe("agent.duplicate", () => {
  let caller: any;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
    // 确保测试库有超级 Agent（全局唯一）
    const services = getServiceContainer(prisma, getEventBus(), getAppConfig());
    await initSwarm(prisma, services, getAppConfig());
  });

  it("复制普通 Agent 并保留配置", async () => {
    const original = await caller.agent.create({
      name: `DuplicateSource_${Date.now()}`,
      description: "源 Agent",
      model: "deepseek-chat",
      systemPrompt: "你是测试 Agent",
      tools: ["native:read_file", "native:write_file"],
      tier: "sub",
    });
    expect(original.success).toBe(true);

    const duplicate = await caller.agent.duplicate({ id: original.data.id });
    expect(duplicate.success).toBe(true);
    expect(duplicate.data.id).not.toBe(original.data.id);
    expect(duplicate.data.name).toBe(original.data.name);
    expect(duplicate.data.description).toBe(original.data.description);
    expect(duplicate.data.model).toBe(original.data.model);
    expect(duplicate.data.systemPrompt).toBe(original.data.systemPrompt);
    expect(duplicate.data.tools).toEqual(original.data.tools);
    expect(duplicate.data.tier).toBe(original.data.tier);
    expect(duplicate.data.source).toBe("duplicate");

    await caller.agent.delete({ id: original.data.id });
    await caller.agent.delete({ id: duplicate.data.id });
  });

  it("复制时允许重名", async () => {
    const name = `SameName_${Date.now()}`;
    const a1 = await caller.agent.create({
      name,
      model: "deepseek-chat",
      systemPrompt: "a1",
      tools: [],
      tier: "sub",
    });
    const a2 = await caller.agent.duplicate({ id: a1.data.id, name });
    expect(a2.success).toBe(true);
    expect(a2.data.name).toBe(name);
    expect(a2.data.id).not.toBe(a1.data.id);
    // 允许重名：UUID 是全局唯一标识，文件 slug 由 Service 生成，这里只验证 id 不同
    const fetchedA1 = await caller.agent.getById({ id: a1.data.id });
    const fetchedA2 = await caller.agent.getById({ id: a2.data.id });
    expect(fetchedA1.name).toBe(fetchedA2.name);
    expect(fetchedA1.id).not.toBe(fetchedA2.id);

    await caller.agent.delete({ id: a1.data.id });
    await caller.agent.delete({ id: a2.data.id });
  });

  it("超级 Agent 不可复制", async () => {
    // 确保有超级 Agent
    const supers = await caller.agent.list({ page: 1, pageSize: 10, tier: "super" });
    expect(supers.items.length).toBeGreaterThan(0);
    const superAgent = supers.items[0];

    await expect(caller.agent.duplicate({ id: superAgent.id })).rejects.toThrow(/超级 Agent/);
  });

  it("复制不存在的 Agent 报 NOT_FOUND", async () => {
    await expect(caller.agent.duplicate({ id: "c00000000000000000000000" })).rejects.toThrow();
  });
});
