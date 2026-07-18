/**
 * W9 AgentFactory + resolveAgent 只读化测试
 *
 * 覆盖：
 * 1. getTierTemplate 模板缺失时 fallback 到 W8 常量并 warn（测试环境 .test-content 无 _templates）
 * 2. 模板文件存在时从 content/agents/_templates/{tier}.md 读取 + {{name}} 占位符渲染
 * 3. 空库首次 initSwarm：super Agent / 系统 Workspace / 主会话正确创建；重复执行幂等
 * 4. createAgentForTier：manager / sub 两个 tier 按模板创建
 * 5. resolveAgent 只读化：检测 drift 但不写库
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import {
  createAgentForTier,
  getTierTemplate,
  resetAgentTemplateCacheForTests,
} from "../infra/agentFactory.js";
import { initSwarm } from "../infra/swarmInitializer.js";
import { resolveAgent, detectAssistantDrift } from "../infra/agentResolver.js";
import { TIER_DEFAULT_TOOLS, ASSISTANT_DEFAULT_TOOLS } from "@knowpilot/shared";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);
const templatesDir = path.join(config.contentPaths.agents, "_templates");

describe("W9 AgentFactory 模板", () => {
  afterAll(() => {
    // 恢复：删除测试写入的模板文件并清缓存，避免影响其他测试文件
    fs.rmSync(templatesDir, { recursive: true, force: true });
    resetAgentTemplateCacheForTests();
  });

  it("模板缺失时 fallback 到 W8 常量并 warn 一次", () => {
    resetAgentTemplateCacheForTests();
    fs.rmSync(templatesDir, { recursive: true, force: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const t = getTierTemplate("super");
    expect(t.tools).toEqual(TIER_DEFAULT_TOOLS.super);
    expect(t.name).toContain("超级 Agent");
    expect(t.heartbeat?.enabled).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);

    // 第二次读取不重复 warn（缓存 + 告警去重）
    getTierTemplate("super");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("模板文件存在时从文件读取并渲染 {{name}} 占位符", () => {
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(templatesDir, "manager.md"),
      [
        "---",
        'name: "{{name}} 管家"',
        'description: "{{name}} 专属"',
        'tier: "manager"',
        "tools:",
        '  - "native:read_file"',
        "---",
        "你是 {{name}} 的管理 Agent（模板定制版）。",
      ].join("\n"),
    );
    resetAgentTemplateCacheForTests();

    const t = getTierTemplate("manager", { vars: { name: "W9Alpha" } });
    expect(t.name).toBe("W9Alpha 管家");
    expect(t.description).toBe("W9Alpha 专属");
    expect(t.systemPrompt).toContain("W9Alpha 的管理 Agent（模板定制版）");
    expect(t.tools).toEqual(["native:read_file"]);
  });
});

describe("W9 createAgentForTier 三 tier 创建", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.chatSession.deleteMany({ where: { agentId: id } }).catch(() => {});
      await prisma.agent.delete({ where: { id } }).catch(() => {});
    }
  });

  it("manager tier：模板默认值 + name 覆盖 + vars 渲染", async () => {
    const agent = await createAgentForTier(prisma, {
      tier: "manager",
      name: "W9Workspace 管理 Agent",
      vars: { name: "W9Workspace" },
    });
    createdIds.push(agent.id);
    expect(agent.tier).toBe("manager");
    expect(agent.name).toBe("W9Workspace 管理 Agent");
    expect(agent.systemPrompt).toContain("W9Workspace 的管理 Agent");
    const tools = agent.tools.split(",");
    for (const required of TIER_DEFAULT_TOOLS.manager) {
      expect(tools).toContain(required);
    }
  });

  it("sub tier：模板默认工具 + overrides 覆盖", async () => {
    const agent = await createAgentForTier(prisma, {
      tier: "sub",
      name: "w9-sub",
      overrides: { systemPrompt: "定制子 Agent", tools: ["native:read_file"] },
    });
    createdIds.push(agent.id);
    expect(agent.tier).toBe("sub");
    expect(agent.systemPrompt).toBe("定制子 Agent");
    expect(agent.tools).toBe("native:read_file");
  });
});

describe("W9 initSwarm 首次启动与幂等", () => {
  it("空库首次启动：创建系统 Workspace + super Agent + 主会话；重复执行不产生重复", async () => {
    await initSwarm(prisma, services, config);

    const systemWs = await prisma.workspace.findFirst({
      where: { isSystem: true, systemType: "super", status: { not: "deleted" } },
    });
    expect(systemWs).toBeTruthy();

    const supers = await prisma.agent.findMany({ where: { tier: "super", status: { not: "deleted" } } });
    expect(supers.length).toBe(1);
    const superAgent = supers[0];
    expect(superAgent.name).toBe("KnowPilot 超级 Agent");
    expect(superAgent.workspaceId).toBe(systemWs!.id);
    const tools = superAgent.tools.split(",");
    for (const required of TIER_DEFAULT_TOOLS.super) {
      expect(tools).toContain(required);
    }
    const heartbeat = superAgent.heartbeat as { enabled?: boolean; cron?: string } | null;
    expect(heartbeat?.enabled).toBe(true);
    expect(heartbeat?.cron).toBe("0 9 * * *");

    const mainSession = await prisma.chatSession.findFirst({
      where: { agentId: superAgent.id, isMainSession: true, status: { not: "deleted" } },
    });
    expect(mainSession).toBeTruthy();

    // Assistant Home 与 Root 对称创建
    const assistantHome = await prisma.workspace.findFirst({
      where: { isSystem: true, systemType: "assistant", status: { not: "deleted" } },
    });
    expect(assistantHome).toBeTruthy();
    expect(assistantHome!.name).toBe("KnowPilot Assistant");

    // 幂等：重复执行不产生重复 Agent / Workspace
    await initSwarm(prisma, services, config);
    const supersAfter = await prisma.agent.findMany({ where: { tier: "super", status: { not: "deleted" } } });
    expect(supersAfter.length).toBe(1);
    const systemWsAfter = await prisma.workspace.findMany({
      where: { isSystem: true, systemType: "super", status: { not: "deleted" } },
    });
    expect(systemWsAfter.length).toBe(1);
    const assistantHomes = await prisma.workspace.findMany({
      where: { isSystem: true, systemType: "assistant", status: { not: "deleted" } },
    });
    expect(assistantHomes.length).toBe(1);
  });
});

describe("W9 resolveAgent 只读化 + drift 提示", () => {
  let driftAssistantId: string | null = null;

  afterAll(async () => {
    if (driftAssistantId) {
      await prisma.chatSession.deleteMany({ where: { agentId: driftAssistantId } }).catch(() => {});
      await prisma.agent.delete({ where: { id: driftAssistantId } }).catch(() => {});
    }
  });

  it("老库漂移 assistant：返回 drift 且不修改数据库", async () => {
    // 清理其他测试文件可能创建的默认 assistant，保证 resolveAgent 命中本 fixture
    await prisma.agent.deleteMany({ where: { name: "assistant" } });
    // 构造一个老库形态的 assistant：旧版提示词 + 工具不全 + 无 tier
    const legacy = await prisma.agent.create({
      data: {
        name: "assistant",
        description: "w9-drift-fixture",
        model: "deepseek-chat",
        systemPrompt:
          "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。",
        tools: "native:web_search",
        tier: "",
      },
    });
    driftAssistantId = legacy.id;

    try {
      const { agent, drift } = await resolveAgent(services);
      expect(agent.id).toBe(legacy.id);
      expect(drift.length).toBeGreaterThan(0);
      expect(drift.some((d) => d.includes("工具"))).toBe(true);
      expect(drift.some((d) => d.includes("系统提示"))).toBe(true);
      expect(drift.some((d) => d.includes("tier"))).toBe(true);

      // 关键断言：读路径不产生写副作用
      const after = await prisma.agent.findUnique({ where: { id: legacy.id } });
      expect(after!.tools).toBe("native:web_search");
      expect(after!.tier).toBe("");
      expect(after!.systemPrompt).toBe(legacy.systemPrompt);

      // detectAssistantDrift 对齐全量默认工具的 agent 应报无漂移
      const healthy = {
        ...(after as object),
        tools: [...ASSISTANT_DEFAULT_TOOLS],
        tier: "manager",
        systemPrompt: "自定义提示词",
      } as Parameters<typeof detectAssistantDrift>[0];
      expect(detectAssistantDrift(healthy)).toEqual([]);
    } finally {
      await prisma.chatSession.deleteMany({ where: { agentId: legacy.id } }).catch(() => {});
      await prisma.agent.delete({ where: { id: legacy.id } }).catch(() => {});
      driftAssistantId = null;
    }
  });

  it("指定 agentId 时 drift 恒为空", async () => {
    const anyAgent = await prisma.agent.findFirst({ where: { status: { not: "deleted" } } });
    expect(anyAgent).toBeTruthy();
    const { agent, drift } = await resolveAgent(services, anyAgent!.id);
    expect(agent.id).toBe(anyAgent!.id);
    expect(drift).toEqual([]);
  });
});
