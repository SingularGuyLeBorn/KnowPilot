/**
 * W4 防线：import 顺序冒烟测试
 *
 * 背景：历史循环依赖环 agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime，
 * nativeTools 值导入 agentRuntime 的 prompt 构建函数，靠 10+ 处 await import() 动态导入躲环。
 * W4 把 prompt 构建抽进 promptBuilder.ts、Agent 解析抽进 agentResolver.ts（均为叶子模块）打断环。
 *
 * 本测试以不同入口文件作为「首个加载模块」（vi.resetModules 后动态 import），
 * 验证任意加载顺序下模块求值都不炸、关键导出不是 undefined
 * （循环依赖的典型症状就是先求值的模块拿到 undefined 的导出）。
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const entries: Array<{ name: string; specifier: string; key: string; kind?: "function" | "object" }> = [
  { name: "nativeTools", specifier: "../infra/nativeTools.js", key: "executeNativeTool" },
  { name: "agentTools", specifier: "../infra/agentTools.js", key: "executeAgentTool" },
  { name: "reactLoop", specifier: "../infra/loop/reactLoop.js", key: "runReactLoop" },
  { name: "agentRuntime", specifier: "../infra/agentRuntime.js", key: "runAgentLoop" },
  { name: "promptBuilder", specifier: "../infra/promptBuilder.js", key: "buildSystemPromptSkeleton" },
  { name: "agentResolver", specifier: "../infra/agentResolver.js", key: "resolveAgent" },
  { name: "contextHooks", specifier: "../infra/contextHooks.js", key: "runContextHooks" },
  { name: "approvalGate", specifier: "../infra/approvalGate.js", key: "assertApprovalOrProceed" },
  { name: "swarmOrchestrator", specifier: "../infra/swarmOrchestrator.js", key: "getSwarmOrchestrator" },
  { name: "inboxShared", specifier: "../infra/inbox/shared.js", key: "ensureInboxDirs" },
  { name: "webhookVerify", specifier: "../infra/channels/webhookVerify.js", key: "gateQqWebhook" },
  { name: "sessionStreamHub", specifier: "../infra/sessionStreamHub.js", key: "getStreamHub" },
  { name: "agentStream", specifier: "../infra/agentStream.js", key: "handleAgentChatStream" },
  { name: "asyncJobManager", specifier: "../infra/asyncJobManager.js", key: "runStartupRecovery" },
  { name: "triggerEngine", specifier: "../infra/triggerEngine.js", key: "getTriggerEngine" },
  { name: "toolService", specifier: "../infra/entityServices/toolService.js", key: "ToolService" },
  { name: "promptService", specifier: "../infra/entityServices/promptService.js", key: "PromptService" },
  { name: "taskService", specifier: "../infra/entityServices/taskService.js", key: "TaskService" },
  { name: "workspaceService", specifier: "../infra/entityServices/workspaceService.js", key: "WorkspaceService" },
  { name: "skillService", specifier: "../infra/entityServices/skillService.js", key: "SkillService" },
  { name: "mcpService", specifier: "../infra/entityServices/mcpService.js", key: "McpService" },
  { name: "memoryService", specifier: "../infra/entityServices/memoryService.js", key: "MemoryService" },
  { name: "gardenService", specifier: "../infra/entityServices/gardenService.js", key: "GardenService" },
  { name: "approvalService", specifier: "../infra/entityServices/approvalService.js", key: "ApprovalService" },
  { name: "inboxService", specifier: "../infra/entityServices/inboxService.js", key: "InboxService" },
  { name: "sessionQueueItemService", specifier: "../infra/entityServices/sessionQueueItemService.js", key: "SessionQueueItemService" },
  { name: "gardenRouter", specifier: "../infra/trpcRouters/gardenRouter.js", key: "gardenRouter", kind: "object" },
  { name: "logRouter", specifier: "../infra/trpcRouters/logRouter.js", key: "logRouter", kind: "object" },
  { name: "toolRouter", specifier: "../infra/trpcRouters/toolRouter.js", key: "toolRouter", kind: "object" },
  { name: "promptRouter", specifier: "../infra/trpcRouters/promptRouter.js", key: "promptRouter", kind: "object" },
  { name: "skillRouter", specifier: "../infra/trpcRouters/skillRouter.js", key: "skillRouter", kind: "object" },
  { name: "mcpRouter", specifier: "../infra/trpcRouters/mcpRouter.js", key: "mcpRouter", kind: "object" },
  { name: "memoryRouter", specifier: "../infra/trpcRouters/memoryRouter.js", key: "memoryRouter", kind: "object" },
  { name: "fileRouter", specifier: "../infra/trpcRouters/fileRouter.js", key: "fileRouter", kind: "object" },
  { name: "infoSourceRouter", specifier: "../infra/trpcRouters/infoSourceRouter.js", key: "infoSourceRouter", kind: "object" },
  { name: "inboxRouter", specifier: "../infra/trpcRouters/inboxRouter.js", key: "inboxRouter", kind: "object" },
  { name: "channelRouter", specifier: "../infra/trpcRouters/channelRouter.js", key: "channelRouter", kind: "object" },
  { name: "messageRouter", specifier: "../infra/trpcRouters/messageRouter.js", key: "messageRouter", kind: "object" },
  { name: "gitRouter", specifier: "../infra/trpcRouters/gitRouter.js", key: "gitRouter", kind: "object" },
  { name: "searchRouter", specifier: "../infra/trpcRouters/searchRouter.js", key: "searchRouter", kind: "object" },
  { name: "analyticsRouter", specifier: "../infra/trpcRouters/analyticsRouter.js", key: "analyticsRouter", kind: "object" },
  { name: "aboutRouter", specifier: "../infra/trpcRouters/aboutRouter.js", key: "aboutRouter", kind: "object" },
  { name: "authRouter", specifier: "../infra/trpcRouters/authRouter.js", key: "authRouter", kind: "object" },
  { name: "nativeRouter", specifier: "../infra/trpcRouters/nativeRouter.js", key: "nativeRouter", kind: "object" },
  { name: "taskRouter", specifier: "../infra/trpcRouters/taskRouter.js", key: "taskRouter", kind: "object" },
  { name: "workspaceRouter", specifier: "../infra/trpcRouters/workspaceRouter.js", key: "workspaceRouter", kind: "object" },
  { name: "triggerRouter", specifier: "../infra/trpcRouters/triggerRouter.js", key: "triggerRouter", kind: "object" },
  { name: "agentCronRouter", specifier: "../infra/trpcRouters/agentCronRouter.js", key: "agentCronRouter", kind: "object" },
  { name: "approvalRouter", specifier: "../infra/trpcRouters/approvalRouter.js", key: "approvalRouter", kind: "object" },
  { name: "askUserRouter", specifier: "../infra/trpcRouters/askUserRouter.js", key: "askUserRouter", kind: "object" },
  { name: "runRouter", specifier: "../infra/trpcRouters/runRouter.js", key: "runRouter", kind: "object" },
  { name: "credentialRouter", specifier: "../infra/trpcRouters/credentialRouter.js", key: "credentialRouter", kind: "object" },
];

describe("W4 import 顺序冒烟（循环依赖防线）", () => {
  for (const entry of entries) {
    it(`以 ${entry.name} 为首个入口加载，模块求值不炸且 ${entry.key} 已定义`, async () => {
      vi.resetModules();
      const mod = (await import(entry.specifier)) as Record<string, unknown>;
      const expectKind = entry.kind ?? "function";
      expect(
        typeof mod[entry.key],
        `${entry.name}.${entry.key} 为 ${typeof mod[entry.key]}——循环依赖导致模块求值顺序问题`,
      ).toBe(expectKind);
    });
  }

  it("源码防线：nativeTools 不得再值导入 agentRuntime（环内模块）", () => {
    const src = readFileSync(path.resolve(__dirname, "../infra/nativeTools.ts"), "utf-8");
    expect(src).not.toMatch(/from\s+["']\.\/agentRuntime\.js["']/);
  });

  it("源码防线：promptBuilder / agentResolver / contextHooks 必须是叶子模块（不 import 环内模块）", () => {
    for (const leaf of ["promptBuilder", "agentResolver", "contextHooks"]) {
      const src = readFileSync(path.resolve(__dirname, `../infra/${leaf}.ts`), "utf-8");
      for (const banned of ["agentRuntime", "nativeTools", "agentTools", "loop/index", "loop/reactLoop", "agentStream"]) {
        expect(
          src.includes(`./${banned}.js`) || src.includes(`../${banned}.js`),
          `${leaf}.ts 不得 import 环内模块 ${banned}`,
        ).toBe(false);
      }
    }
  });
});
