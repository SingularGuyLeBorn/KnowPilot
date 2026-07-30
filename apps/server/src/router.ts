/**
 * KnowPilot 根路由合集与编译出口 (Root Router)
 *
 * 【扁平化 + 按需叶子拆分】：
 * 1. 本文件只聚合 `infra/trpcRouters/*` 出口 `AppRouter`。
 * 2. 禁止平行 trpc/routers/ 树与兼容 re-export。
 */

import { router } from "./trpc/trpc.js";
import { gardenRouter } from "./infra/trpcRouters/gardenRouter.js";
import { postRouter } from "./infra/trpcRouters/postRouter.js";
import { agentRouter } from "./infra/trpcRouters/agentRouter.js";
import { skillRouter } from "./infra/trpcRouters/skillRouter.js";
import { sessionRouter } from "./infra/trpcRouters/sessionRouter.js";
import { messageRouter } from "./infra/trpcRouters/messageRouter.js";
import { fileRouter } from "./infra/trpcRouters/fileRouter.js";
import { logRouter } from "./infra/trpcRouters/logRouter.js";
import { mcpRouter } from "./infra/trpcRouters/mcpRouter.js";
import { memoryRouter } from "./infra/trpcRouters/memoryRouter.js";
import { infoSourceRouter } from "./infra/trpcRouters/infoSourceRouter.js";
import { inboxRouter } from "./infra/trpcRouters/inboxRouter.js";
import { channelRouter } from "./infra/trpcRouters/channelRouter.js";
import { gitRouter } from "./infra/trpcRouters/gitRouter.js";
import { searchRouter } from "./infra/trpcRouters/searchRouter.js";
import { analyticsRouter } from "./infra/trpcRouters/analyticsRouter.js";
import { aboutRouter } from "./infra/trpcRouters/aboutRouter.js";
import { authRouter } from "./infra/trpcRouters/authRouter.js";
import { nativeRouter } from "./infra/trpcRouters/nativeRouter.js";
import { taskRouter } from "./infra/trpcRouters/taskRouter.js";
import { workspaceRouter } from "./infra/trpcRouters/workspaceRouter.js";
import { triggerRouter } from "./infra/trpcRouters/triggerRouter.js";
import { agentCronRouter } from "./infra/trpcRouters/agentCronRouter.js";
import { approvalRouter } from "./infra/trpcRouters/approvalRouter.js";
import { askUserRouter } from "./infra/trpcRouters/askUserRouter.js";
import { toolRouter } from "./infra/trpcRouters/toolRouter.js";
import { runRouter } from "./infra/trpcRouters/runRouter.js";
import { promptRouter } from "./infra/trpcRouters/promptRouter.js";
import { credentialRouter } from "./infra/trpcRouters/credentialRouter.js";
import { llmRouter } from "./infra/trpcRouters/llmRouter.js";
import { aiRouter } from "./infra/trpcRouters/aiRouter.js";
import { deadLetterRouter } from "./infra/trpcRouters/deadLetterRouter.js";

export const appRouter = router({
  garden: gardenRouter,
  post: postRouter,
  agent: agentRouter,
  skill: skillRouter,
  session: sessionRouter,
  message: messageRouter,
  file: fileRouter,
  log: logRouter,
  mcp: mcpRouter,
  memory: memoryRouter,
  infoSource: infoSourceRouter,
  inbox: inboxRouter,
  channel: channelRouter,
  git: gitRouter,
  search: searchRouter,
  analytics: analyticsRouter,
  about: aboutRouter,
  auth: authRouter,
  native: nativeRouter,
  task: taskRouter,
  workspace: workspaceRouter,
  trigger: triggerRouter,
  agentCron: agentCronRouter,
  approval: approvalRouter,
  askUser: askUserRouter,
  tool: toolRouter,
  run: runRouter,
  prompt: promptRouter,
  credential: credentialRouter,
  llm: llmRouter,
  ai: aiRouter,
  deadLetter: deadLetterRouter,
});

export type AppRouter = typeof appRouter;
