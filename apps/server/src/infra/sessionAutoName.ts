/**
 * Session / Agent 异步自动命名 —— 首条消息时调 LLM 写入 autoName 字段，fire-and-forget，失败静默。
 * 不动 title / name：显示时 autoName 优先，没有才用 title / name。
 * 幂等：autoName 已有值就跳过，不会重复命名。
 */

const MODEL = "deepseek-v4-flash";

const SESSION_PROMPT =
  "根据用户消息生成 6-12 字中文标题。直接输出标题，不要引号/句号/emoji/前缀。";

const AGENT_PROMPT =
  "根据任务给子 Agent 起名。2-8 字中文，正常名字，不能含特殊符号/引号/括号/emoji，不能以「子 Agent」开头。直接输出名字。";

function clean(s: string, max: number): string {
  return s.replace(/[\r\n"]/g, "").trim().slice(0, max);
}

export async function autoNameSession(sessionId: string, firstMessage: string): Promise<void> {
  try {
    const { prisma } = await import("../db.js");
    const { getAppConfig } = await import("./config.js");
    const { chatCompletion } = await import("./llmClient.js");
    const { getStreamHub } = await import("./sessionStreamHub.js");
    // 幂等：autoName 已有值就跳过；且仅首条消息时命名（msgCount<=1），避免老 session 被追溯命名
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { autoName: true } });
    if (!session || session.autoName) return;
    const msgCount = await prisma.chatMessage.count({ where: { sessionId } });
    if (msgCount > 1) return;
    const { content } = await chatCompletion({
      config: getAppConfig(),
      model: MODEL,
      messages: [{ role: "system", content: SESSION_PROMPT }, { role: "user", content: firstMessage.slice(0, 500) }],
      maxTokens: 80,
      temperature: 0.3,
      enableReasoning: false, // 推理模型会把 token 全花在 reasoningContent 上，content 返回 null
    });
    const title = clean(content ?? "", 40);
    if (!title) return;
    await prisma.chatSession.update({ where: { id: sessionId }, data: { autoName: title } });
    getStreamHub()?.pushExternalEvent(sessionId, { type: "session_title_updated", sessionId, title } as any);
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
    const { content } = await chatCompletion({
      config: getAppConfig(),
      model: MODEL,
      messages: [{ role: "system", content: AGENT_PROMPT }, { role: "user", content: task.slice(0, 500) }],
      maxTokens: 60,
      temperature: 0.4,
      enableReasoning: false, // 推理模型会把 token 全花在 reasoningContent 上，content 返回 null
    });
    const name = clean(content ?? "", 30);
    if (!name || /^子\s*Agent/i.test(name)) return;
    await prisma.agent.update({ where: { id: agentId }, data: { autoName: name } });
    const mainSession = await prisma.chatSession.findFirst({
      where: { agentId, isMainSession: true, status: { not: "deleted" } },
      select: { id: true },
    });
    if (mainSession) {
      getStreamHub()?.pushExternalEvent(mainSession.id, { type: "agent_renamed", agentId, name } as any);
    }
  } catch (e) {
    console.warn(`[autoNameAgent] ${agentId}:`, e instanceof Error ? e.message : e);
  }
}
