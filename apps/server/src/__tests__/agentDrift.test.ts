/**
 * W16d-3：agent.driftStatus tRPC 通道测试
 *
 * 1. 通道返回默认 assistant 漂移摘要 + 迁移脚本提示（只读：不创建、不修改）
 * 2. 人为制造漂移（摘掉一个内置默认工具）→ drift 增长并点名缺失工具；恢复后回到基线
 */

import { describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { prisma } from "../db.js";
import { ASSISTANT_DEFAULT_TOOLS } from "@knowpilot/shared";
import { DEFAULT_ASSISTANT_SYSTEM_PROMPT } from "../infra/agentResolver.js";

describe("S9 防线：默认 assistant 提示词与双工具分工一致", () => {
  it("不再把 async_task_run 描述为派生子代理（纯工具执行，不跑 LLM）", () => {
    // W-D 后派生子代理唯一通道 = spawn_subagent；async_task_run 仅后台执行纯工具调用。
    // 提示词若仍引导用 async_task_run 派生子代理属过时契约文案（终审 S9），防线防回归。
    expect(DEFAULT_ASSISTANT_SYSTEM_PROMPT).not.toContain("或 native:async_task_run 派生子代理");
  });
});

describe("W16d-3 agent.driftStatus tRPC 通道", () => {
  // test.db 全量共享：不依赖文件执行顺序，每个用例前清掉 assistant 保证前置态密闭
  // （v9 终审 P1：原实现依赖「本文件字母序最先跑」的脆弱前置，全量套件间歇性 2 failed——
  // assistant 已被其他文件创建时 null 断言红 + fixture 唯一约束撞车）
  beforeEach(async () => {
    await prisma.agent.deleteMany({ where: { name: "assistant" } });
  });

  it("无 assistant 时如实返回 null 且不引导创建（管理页查询零写副作用）", async () => {
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.driftStatus();
    expect(result.migrationHint).toContain("migrate-assistant-tools");
    expect(result.agentId).toBeNull();
    expect(result.agentName).toBeNull();
    expect(result.drift).toEqual([]);
  });

  it("返回漂移摘要 + 迁移提示；制造漂移后 drift 增长并点名缺失工具，恢复后回到基线", async () => {
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);

    // 自建 assistant fixture：getAssistantDriftStatus 只读不创建，fresh 测试库无 assistant——
    // 旧形态无 fixture，靠 early return 静默跳过全部增量断言（v6 复审 P2-1 抓出的假绿）。
    // 负向断言：删掉 fixture 创建，下方 expect(before.agentId).toBeTruthy() 在 fresh 库必红。
    const fixture = await ctx.services.agent.create({
      name: "assistant",
      description: "KnowPilot 默认助手（测试 fixture）",
      model: "deepseek-chat",
      systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
      tools: [...ASSISTANT_DEFAULT_TOOLS],
      tier: "manager",
    });
    if (!fixture.success || !fixture.data) {
      throw new Error(`创建 assistant fixture 失败：${fixture.error?.message}`);
    }
    const fixtureId = (fixture.data as { id: string }).id;

    try {
      const before = await caller.agent.driftStatus();
      expect(before.migrationHint).toContain("migrate-assistant-tools");
      expect(Array.isArray(before.drift)).toBe(true);
      expect(before.agentId).toBeTruthy();
      expect(before.agentName).toBeTruthy();
      // fixture 为完整默认配置：基线零漂移
      expect(before.drift).toEqual([]);

      const agent = await ctx.services.agent.getById(before.agentId!);
      const originalTools = agent.tools;
      const removable = ASSISTANT_DEFAULT_TOOLS.find((t) => originalTools.includes(t));
      // fixture 带全量默认工具，必有可摘项；若为 undefined 说明 ASSISTANT_DEFAULT_TOOLS 契约已变
      expect(removable).toBeTruthy();

      try {
        const updated = await ctx.services.agent.update({
          id: agent.id,
          tools: originalTools.filter((t) => t !== removable),
        });
        if (!updated.success) throw new Error(`制造漂移失败：${updated.error?.message}`);

        const after = await caller.agent.driftStatus();
        expect(after.agentId).toBe(before.agentId);
        expect(after.drift.length).toBeGreaterThan(before.drift.length);
        expect(after.drift.join("；")).toContain(removable!);
      } finally {
        await ctx.services.agent.update({ id: agent.id, tools: originalTools });
      }

      const restored = await caller.agent.driftStatus();
      expect(restored.drift).toEqual(before.drift);
    } finally {
      // 清理 fixture：test.db 全量共享，残留 assistant 会污染后续文件的 resolveAgent 候选查找
      await prisma.agent.delete({ where: { id: fixtureId } }).catch(() => {});
    }
  });
});
