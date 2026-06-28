/**
 * 本地 E2E 冒烟：验证 agent.chat + native 工具链路
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/smoke-agent-chat.ts
 */

import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";

async function main() {
  const ctx = await createContextInner();
  const caller = appRouter.createCaller(ctx);

  const agents = await caller.agent.list({ page: 1, pageSize: 5 });
  console.log(
    "Agents:",
    agents.items.map((a) => ({ name: a.name, tools: a.tools.length })),
  );

  const providers = await caller.agent.llmProviders();
  console.log("LLM providers:", providers);

  if (providers.length === 0) {
    console.warn("⚠️ 未配置 LLM API Key，跳过 agent.chat 实调用");
    return;
  }

  const res = await caller.agent.chat({
    message: "用 list_directory 工具查看 content/agents 目录，一句话回复有哪些文件",
  });

  console.log("chat success:", res.success);
  if (res.success && res.data) {
    console.log("reply:", res.data.message?.content?.slice(0, 300));
    console.log(
      "tools:",
      res.data.toolCalls?.map((t) => t.name),
    );
    console.log("rounds:", res.data.roundsUsed);
  } else {
    console.log("error:", res.error?.message);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
