/**
 * tRPC 根 Router
 *
 * 所有子 router 在这里合并，导出给前端使用的 AppRouter 类型。
 */

import { router } from "./trpc.js";
import { postRouter } from "./routers/post.js";
import { agentRouter } from "./routers/agent.js";
import { skillRouter } from "./routers/skill.js";
import { sessionRouter } from "./routers/session.js";
import { messageRouter } from "./routers/message.js";
import { fileRouter } from "./routers/file.js";
import { logRouter } from "./routers/log.js";
import { mcpRouter } from "./routers/mcp.js";
import { memoryRouter } from "./routers/memory.js";
import { gitRouter } from "./routers/git.js";
import { taskRouter } from "./routers/task.js";
import { workspaceRouter } from "./routers/workspace.js";
import { triggerRouter } from "./routers/trigger.js";
import { approvalRouter } from "./routers/approval.js";

export const appRouter = router({
  post: postRouter,
  agent: agentRouter,
  skill: skillRouter,
  session: sessionRouter,
  message: messageRouter,
  file: fileRouter,
  log: logRouter,
  mcp: mcpRouter,
  memory: memoryRouter,
  git: gitRouter,
  task: taskRouter,
  workspace: workspaceRouter,
  trigger: triggerRouter,
  approval: approvalRouter,
});

/** 导出类型供前端使用 — 这是 tRPC 的核心价值 */
export type AppRouter = typeof appRouter;

