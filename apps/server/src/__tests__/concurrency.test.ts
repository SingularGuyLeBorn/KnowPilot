/**
 * 并发/竞态测试（#18）—— 覆盖 P1 凭据注入幂等性与 A6 bulkDelete 并发安全。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import {
  ensureIntegrationCredentialsInjected,
  invalidateIntegrationCredentials,
} from "../infra/credentialVault.js";

describe("并发/竞态测试（#18）", () => {
  let caller: any;
  let ctx: any;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  it("P1：ensureIntegrationCredentialsInjected 并发调用幂等且不抛错，config 保持一致", async () => {
    // 10 个并发 ensure 应被 memo 合并为单次注入，全部 resolve
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureIntegrationCredentialsInjected(ctx.config, ctx.prisma)),
    );
    expect(results.length).toBe(10);
    // 注入后 config.integrations 存在（feishu 等字段为对象）
    expect(ctx.config.integrations).toBeDefined();
    expect(typeof ctx.config.integrations.feishu).toBe("object");

    // 二次 ensure 已注入 → 立即返回，不抛错
    await ensureIntegrationCredentialsInjected(ctx.config, ctx.prisma);
    expect(ctx.config.integrations).toBeDefined();
  });

  it("P1：invalidate 后再次 ensure 重新注入，config 仍一致", async () => {
    await invalidateIntegrationCredentials(ctx.config, ctx.prisma);
    await ensureIntegrationCredentialsInjected(ctx.config, ctx.prisma);
    expect(typeof ctx.config.integrations.github).toBe("object");
  });

  it("A6：两组不相交 agent 的并发 bulkDelete 互不干扰", async () => {
    const a1 = await caller.agent.create({ name: `ConcA_${Date.now()}_1`, model: "deepseek-chat" });
    const a2 = await caller.agent.create({ name: `ConcA_${Date.now()}_2`, model: "deepseek-chat" });
    const a3 = await caller.agent.create({ name: `ConcB_${Date.now()}_1`, model: "deepseek-chat" });
    const a4 = await caller.agent.create({ name: `ConcB_${Date.now()}_2`, model: "deepseek-chat" });
    expect([a1, a2, a3, a4].every((r) => r.success)).toBe(true);

    // 并发删除两组不相交 id
    const [r1, r2] = await Promise.all([
      caller.agent.bulkDelete({ ids: [a1.data!.id, a2.data!.id] }),
      caller.agent.bulkDelete({ ids: [a3.data!.id, a4.data!.id] }),
    ]);
    expect(r1.deleted).toBe(2);
    expect(r2.deleted).toBe(2);

    // 四条均不可再查
    for (const id of [a1.data!.id, a2.data!.id, a3.data!.id, a4.data!.id]) {
      await expect(caller.agent.getById({ id })).rejects.toThrow();
    }
  });
});
