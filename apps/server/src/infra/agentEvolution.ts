/**
 * AgentEvolution — Agent 进化高级版（Hermes 式自我改进）
 *
 * 能力：
 * 1. 经验自动积累：每次 Run 完成后，自动总结经验写入 Memory（kind="experience"）
 * 2. System Prompt 自动优化：管理 Agent 定期审查子 Agent 的经验，优化其 prompt
 * 3. Skill 自动生成：从重复的操作模式中提炼 Skill
 *
 * 触发方式：
 * - 经验积累：agentStream 的 onDone 回调中自动调用
 * - Prompt 优化：管理 Agent 心跳时通过 optimize_sub_agent_prompt 工具触发
 * - Skill 生成：管理 Agent 通过 generate_skill_from_experience 工具触发
 */

import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import type { StoredToolCall } from "./chatHistory.js";
import { createMemoryRepository } from "./memoryRepository.js";
import { MEMORY_TYPES, memoryAgentScope, memoryWorkspaceScope } from "@knowpilot/shared";

interface ExperienceSummary {
  taskDescription: string;
  toolsUsed: string[];
  success: boolean;
  durationMs: number;
  tokenUsage: { prompt: number; completion: number; total: number } | null;
  keyLearnings: string;
}

/**
 * 从一次 Run 中提取经验并写入 Memory
 * 在 agentStream onDone 后调用
 */
export async function accumulateExperience(
  prisma: PrismaClient,
  services: ServiceContainer,
  agentId: string,
  sessionId: string,
  result: {
    content: string;
    toolCalls: StoredToolCall[];
    tokenUsage: { prompt: number; completion: number; total: number } | null;
    roundsUsed: number;
  },
  input: { message: string; trigger?: string; workspaceId?: string | null },
  durationMs: number,
): Promise<void> {
  try {
    const tools = result.toolCalls.filter((t) => t.kind === "tool");
    const toolNames = tools.map((t) => t.name);
    const success = !!result.content.trim();

    // 简化经验总结：工具使用 + 成功/失败 + 耗时
    const experience: ExperienceSummary = {
      taskDescription: input.message.slice(0, 200),
      toolsUsed: [...new Set(toolNames)],
      success,
      durationMs,
      tokenUsage: result.tokenUsage,
      keyLearnings: success
        ? `任务成功完成。使用了 ${toolNames.length} 次工具调用（${[...new Set(toolNames)].join(", ")}），耗时 ${Math.round(durationMs / 1000)}s。`
        : `任务可能失败。内容为空或被中断。使用了 ${toolNames.length} 次工具调用。`,
    };

    // 写入 Memory（type="experience"，scope=agent:{id} 写时隔离——W5：不再直查 Prisma，
    // 统一走 MemoryRepository，保证文件回写 + FTS 增量同步，且其他 Agent 上下文不可见）
    const repo = createMemoryRepository(services);
    const memoryBase = {
      content: JSON.stringify(experience),
      type: MEMORY_TYPES.EXPERIENCE,
      strength: success ? 1.0 : 0.5,
      keywords: [...new Set(toolNames), input.trigger ?? "user", success ? "success" : "failed"],
    };
    await repo.write({ ...memoryBase, scope: memoryAgentScope(agentId) });

    // W5-followup 三层落地：Agent 属于 Workspace 时，经验同步沉淀到 workspace 层——
    // 管理/超级 Agent 一次 memory_search 即可看到全 Workspace 的经验（sub 无 memory 工具权限，
    // 见 swarmPermissionGuard）；agent 层私有副本保留，供按 Agent 审查
    // （optimize_sub_agent_prompt / generate_skill_from_experience）。
    if (input.workspaceId) {
      await repo.write({ ...memoryBase, scope: memoryWorkspaceScope(input.workspaceId) });
    }

    // 更新 Agent 状态（活跃度）
    await prisma.agent.update({
      where: { id: agentId },
      data: { status: "active" },
    }).catch(() => {});
  } catch (err) {
    console.warn(`[AgentEvolution] 经验积累失败 for ${agentId}:`, err);
  }
}

/**
 * 自动优化子 Agent 的 system prompt
 * 管理 Agent 通过工具调用触发
 */
export async function optimizeAgentPrompt(
  prisma: PrismaClient,
  services: ServiceContainer,
  targetAgentId: string,
  operatorAgentId: string,
): Promise<{ success: boolean; optimized?: string; reason?: string }> {
  try {
    const agent = await prisma.agent.findUnique({ where: { id: targetAgentId } });
    if (!agent || agent.status === "deleted") {
      return { success: false, reason: "目标 Agent 不存在或已删除" };
    }
    if (agent.tier === "super") {
      return { success: false, reason: "不能优化超级 Agent 的 prompt" };
    }

    // 查该 Agent 最近 20 条经验（global 共享经验 + 本 Agent scope）
    const repo = createMemoryRepository(services);
    const experiences = await repo.read({
      types: [MEMORY_TYPES.EXPERIENCE],
      scopes: [memoryAgentScope(targetAgentId), "global"],
      limit: 20,
    });

    if (experiences.length < 5) {
      return { success: false, reason: "经验不足 5 条，暂不优化" };
    }

    // 分析经验模式
    const successCount = experiences.filter((e) => {
      try {
        const exp = JSON.parse(e.content) as ExperienceSummary;
        return exp.success;
      } catch {
        return false;
      }
    }).length;

    const successRate = (successCount / experiences.length) * 100;
    const allTools = experiences.flatMap((e) => {
      try {
        return (JSON.parse(e.content) as ExperienceSummary).toolsUsed;
      } catch {
        return [];
      }
    });
    const toolFrequency = new Map<string, number>();
    for (const t of allTools) {
      toolFrequency.set(t, (toolFrequency.get(t) ?? 0) + 1);
    }
    const topTools = [...toolFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    // 构建优化建议（追加到现有 prompt，不覆盖）
    const optimizationNote = `\n\n## 自动优化（${new Date().toISOString().slice(0, 10)}）
- 近期成功率：${successRate.toFixed(0)}%
- 高频工具：${topTools.map(([name, count]) => `${name}(${count})`).join(", ")}
${successRate < 60 ? "- 建议：成功率偏低，检查任务描述是否清晰，工具是否合适。\n" : ""}${topTools.length > 3 ? "- 建议：使用工具较多，考虑封装为 Skill 减少调用次数。\n" : ""}`;

    const optimized = agent.systemPrompt + optimizationNote;

    // 更新 prompt（运行中用旧配置，下次启动用新配置 #11）
    await services.agent.update({ id: targetAgentId, systemPrompt: optimized } as any);

    // 审计日志
    await prisma.log.create({
      data: {
        level: "info",
        component: "swarm",
        event: "agent_prompt_optimized",
        message: `Agent ${agent.name} 的 system prompt 被自动优化（成功率 ${successRate.toFixed(0)}%）`,
        metadata: { agentId: targetAgentId, operatorAgentId, successRate, experienceCount: experiences.length },
      },
    }).catch(() => {});

    return { success: true, optimized: optimizationNote };
  } catch (err) {
    return { success: false, reason: `优化失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 从经验模式中自动生成 Skill
 * 管理 Agent 通过工具调用触发
 */
export async function generateSkillFromExperience(
  prisma: PrismaClient,
  services: ServiceContainer,
  agentId: string,
  skillName: string,
  skillDescription: string,
): Promise<{ success: boolean; skillId?: string; reason?: string }> {
  try {
    // 查该 Agent 的经验（global 共享经验 + 本 Agent scope）
    const repo = createMemoryRepository(services);
    const experiences = await repo.read({
      types: [MEMORY_TYPES.EXPERIENCE],
      scopes: [memoryAgentScope(agentId), "global"],
      limit: 30,
    });

    if (experiences.length < 3) {
      return { success: false, reason: "经验不足 3 条，无法生成 Skill" };
    }

    // 提取高频工具组合
    const toolCombos = new Map<string, number>();
    for (const exp of experiences) {
      try {
        const data = JSON.parse(exp.content) as ExperienceSummary;
        if (data.toolsUsed.length > 0) {
          const combo = data.toolsUsed.sort().join(",");
          toolCombos.set(combo, (toolCombos.get(combo) ?? 0) + 1);
        }
      } catch { /* ignore */ }
    }

    const topCombo = [...toolCombos.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!topCombo || topCombo[1] < 2) {
      return { success: false, reason: "无高频工具组合，无法提炼 Skill" };
    }

    const tools = topCombo[0].split(",");
    const skillCode = `// 自动生成的 Skill：${skillName}
// 基于近期 ${experiences.length} 条经验，高频工具组合：${tools.join(" → ")}
// 使用频率：${topCombo[1]} 次
async function execute(context) {
  const { invokeTool } = context;
  ${tools.map((t: string) => `// 步骤：调用 ${t}\n// await invokeTool("${t}", {});`).join("\n  ")}
  return { status: "skill_executed", tools: ${JSON.stringify(tools)} };
}`;

    // 创建 Skill
    const created = await services.skill.create({
      name: skillName,
      description: skillDescription,
      code: skillCode,
      icon: "Sparkles",
      enabled: true,
      metaJson: JSON.stringify({
        autoGenerated: true,
        generatedFrom: "experience",
        experienceCount: experiences.length,
        toolCombo: tools,
        frequency: topCombo[1],
        generatedAt: new Date().toISOString(),
      }),
    } as any);

    if (!created.success || !created.data) {
      return { success: false, reason: created.error?.message ?? "Skill 创建失败" };
    }

    // 审计日志
    await prisma.log.create({
      data: {
        level: "info",
        component: "swarm",
        event: "skill_auto_generated",
        message: `Skill ${skillName} 从经验中自动生成（工具组合：${tools.join(",")}）`,
        metadata: { skillId: created.data.id, agentId, toolCombo: tools, frequency: topCombo[1] },
      },
    }).catch(() => {});

    return { success: true, skillId: created.data.id };
  } catch (err) {
    return { success: false, reason: `Skill 生成失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
