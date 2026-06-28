import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";

async function main() {
  const ctx = await createContextInner();
  const caller = appRouter.createCaller(ctx);

  try {
    const agents = await caller.agent.list({ page: 1, pageSize: 50 });
    console.log("agent.list OK", agents.items?.length);
  } catch (e) {
    console.error("agent.list FAIL", e);
  }

  try {
    const sessions = await caller.session.list({ page: 1, pageSize: 30 });
    console.log("session.list OK", sessions.items?.length);
  } catch (e) {
    console.error("session.list FAIL", e);
  }

  try {
    const providers = await caller.agent.llmProviders();
    console.log("llmProviders OK", providers);
  } catch (e) {
    console.error("llmProviders FAIL", e);
  }

  try {
    const res = await caller.agent.chat({ message: "hi" });
    console.log("agent.chat", res.success, res.error?.message ?? res.data?.message?.content?.slice(0, 80));
  } catch (e) {
    console.error("agent.chat THROW", e);
  }
}

main();
