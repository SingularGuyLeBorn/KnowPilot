/**
 * Session / Agent 异步自动命名 —— 首条消息时调 LLM 写入 autoName 字段，fire-and-forget，失败静默。
 * Session：只写 autoName，不动 title。Agent：写 autoName；若 name 仍是「子 Agent xxxx」占位则一并覆写 name。
 * 幂等：autoName 已有值就跳过，不会重复命名。
 */

const AUTO_NAME_TIMEOUT_MS = 30_000; // 命名是 fire-and-forget，LLM 挂起时不能无限占用连接

const SESSION_PROMPT =
  "根据用户消息生成 6-12 字中文标题。直接输出标题，不要引号/句号/emoji/前缀。";

const AGENT_PROMPT =
  "根据任务给子 Agent 起名。2-8 字中文，正常名字，不能含特殊符号/引号/括号/emoji，不能以「子 Agent」开头。直接输出名字。";

function clean(s: string, max: number): string {
  return s
    .replace(/[\r\n"`]/g, "")
    .replace(/[\[\]{}()【】（）]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "")
    .trim()
    .slice(0, max);
}

export async function autoNameSession(sessionId: string, firstMessage: string): Promise<void> {
  try {
    const { prisma } = await import("../db.js");
    const { getAppConfig } = await import("./config.js");
    const { chatCompletion } = await import("./llmClient.js");
    const { getStreamHub } = await import("./sessionStreamHub.js");
    // 幂等唯一守卫：autoName 已有值就跳过（命名过就不再命名）。
    // 不要用 msgCount>1 守卫——autoNameSession 与 agent 流并发，assistant 消息可能在
    // 本检查前写入 DB，使 msgCount 变成 2 → 误判为「非首条」跳过命名。
    // 快回复会话因此竞态输给 assistant 消息、永远不被命名；带工具的慢会话才赢得竞态。
    // autoName=null 的老会话被追溯命名一次是期望行为（用户重新打开时补名字）。
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { autoName: true } });
    if (!session || session.autoName) return;
    const config = getAppConfig();
    const { content } = await chatCompletion({
      config,
      model: config.llm.defaultModel,
      messages: [{ role: "system", content: SESSION_PROMPT }, { role: "user", content: firstMessage.slice(0, 500) }],
      maxTokens: 80,
      temperature: 0.3,
      enableReasoning: false, // 推理模型会把 token 全花在 reasoningContent 上，content 返回 null
      signal: AbortSignal.timeout(AUTO_NAME_TIMEOUT_MS),
    });
    const title = clean(content ?? "", 40);
    if (!title) return;
    await prisma.chatSession.update({ where: { id: sessionId }, data: { autoName: title } });
    getStreamHub()?.pushExternalEvent(sessionId, { type: "session_title_updated", sessionId, title });
  } catch (e) {
    console.warn(`[autoNameSession] ${sessionId}:`, e instanceof Error ? e.message : e);
  }
}

export async function autoNameAgent(agentId: string, task: string): Promise<void> {
  try {
    const { prisma } = await import("../db.js");
    const { getAppConfig } = await import("./config.js");
    const { chatCompletion } = await import("./llmClient.js");
    const { getStreamHub } = await import("./sessionStreamHub.js");
    // 幂等：autoName 已有值就跳过
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { autoName: true, name: true } });
    if (!agent || agent.autoName) return;
    const config = getAppConfig();
    const { content } = await chatCompletion({
      config,
      model: config.llm.defaultModel,
      messages: [{ role: "system", content: AGENT_PROMPT }, { role: "user", content: task.slice(0, 500) }],
      maxTokens: 60,
      temperature: 0.4,
      enableReasoning: false, // 推理模型会把 token 全花在 reasoningContent 上，content 返回 null
      signal: AbortSignal.timeout(AUTO_NAME_TIMEOUT_MS),
    });
    const name = clean(content ?? "", 30);
    if (!name || /^子\s*Agent/i.test(name)) return;
    // autoName 供列表/角标展示；若仍是占位 name（子 Agent xxxx），一并覆写 name，避免下游快照继续冻住碎片 id
    const patch: { autoName: string; name?: string } = { autoName: name };
    if (/^子\s*Agent\s+[a-z0-9]+$/i.test(agent.name)) patch.name = name;
    await prisma.agent.update({ where: { id: agentId }, data: patch });
    const mainSession = await prisma.chatSession.findFirst({
      where: { agentId, isMainSession: true, status: { not: "deleted" } },
      select: { id: true },
    });
    if (mainSession) {
      getStreamHub()?.pushExternalEvent(mainSession.id, { type: "agent_renamed", agentId, name });
    }
  } catch (e) {
    console.warn(`[autoNameAgent] ${agentId}:`, e instanceof Error ? e.message : e);
  }
}
