/**
 * E2E 夹具：创建「仅有用户消息、无助手回复」的会话（模拟流式中断场景）
 */

export interface UserOnlySessionFixture {
  sessionId: string;
  title: string;
  userMessageId: string;
}

export async function createUserOnlySession(): Promise<UserOnlySessionFixture> {
  const { appRouter } = await import("../../../server/src/router.js");
  const { createContextInner } = await import("../../../server/src/trpc/context.js");

  const ctx = await createContextInner();
  const caller = appRouter.createCaller(ctx);

  const agents = await caller.agent.list({ page: 1, pageSize: 20 });
  const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
  if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

  const title = `E2E 思考重复 ${Date.now()}`;
  const sessionRes = await caller.session.create({
    title,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
  });
  const sessionId = sessionRes.data!.id;

  const msgRes = await caller.message.create({
    sessionId,
    role: "user",
    content: "用 list_directory 工具查看 content/agents 目录，一句话回复有哪些文件",
  });

  return {
    sessionId,
    title,
    userMessageId: msgRes.data!.id,
  };
}
