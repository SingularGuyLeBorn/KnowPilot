/**
 * W16d-3：agent.driftStatus tRPC 通道测试
 *
 * 1. 通道返回默认 assistant 漂移摘要 + 迁移脚本提示（只读：不创建、不修改）
 * 2. 人为制造漂移（摘掉一个内置默认工具）→ drift 增长并点名缺失工具；恢复后回到基线
 */

import { describe, it, expect } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
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
  it("返回漂移摘要 + 迁移提示；制造漂移后 drift 增长并点名缺失工具，恢复后回到基线", async () => {
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);

    const before = await caller.agent.driftStatus();
    expect(before.migrationHint).toContain("migrate-assistant-tools");
    expect(Array.isArray(before.drift)).toBe(true);
    if (!before.agentId) {
      // 无 assistant 的环境：如实返回 null 且不引导创建（管理页查询零写副作用）
      expect(before.agentName).toBeNull();
      expect(before.drift).toEqual([]);
      return;
    }
    expect(before.agentName).toBeTruthy();

    const agent = await ctx.services.agent.getById(before.agentId);
    const originalTools = agent.tools;
    const removable = ASSISTANT_DEFAULT_TOOLS.find((t) => originalTools.includes(t));
    if (!removable) return; // 基线已缺全部默认工具，跳过增量断言

    try {
      const updated = await ctx.services.agent.update({
        id: agent.id,
        tools: originalTools.filter((t) => t !== removable),
      });
      if (!updated.success) throw new Error(`制造漂移失败：${updated.error?.message}`);

      const after = await caller.agent.driftStatus();
      expect(after.agentId).toBe(before.agentId);
      expect(after.drift.length).toBeGreaterThan(before.drift.length);
      expect(after.drift.join("；")).toContain(removable);
    } finally {
      await ctx.services.agent.update({ id: agent.id, tools: originalTools });
    }

    const restored = await caller.agent.driftStatus();
    expect(restored.drift).toEqual(before.drift);
  });
});
