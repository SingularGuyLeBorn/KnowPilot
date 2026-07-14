/**
 * 默认 assistant 配置迁移脚本（一次性，可重复执行；幂等）
 *
 * 背景（W9）：resolveAgent 历史上会在读路径「顺手 update」老库默认 assistant 的
 * 工具清单 / 系统提示 / tier，读路径写副作用已移除，改为返回 drift 提示。
 * 本脚本是对老数据库的显式修复入口，执行与历史自动补齐等价的更新：
 *   1. 工具清单缺少 ASSISTANT_DEFAULT_TOOLS 成员 → 合并补齐（不删除已有工具）
 *   2. 系统提示为空或仍是旧版默认 → 升级为当前默认（用户自定义提示词不动）
 *   3. tier 为空 → 置为 manager（已明确指定 tier 的不动）
 *
 * 执行方式（项目根目录或 apps/server 下均可）：
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-assistant-tools.ts
 *
 * 无漂移时输出 "无需迁移" 并退出，不写库。
 */
import { PrismaClient } from "@prisma/client";
import { ASSISTANT_DEFAULT_TOOLS } from "@knowpilot/shared";
import { getAppConfig, loadRootEnv } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { detectAssistantDrift, DEFAULT_ASSISTANT_SYSTEM_PROMPT } from "../infra/agentResolver.js";

const prisma = new PrismaClient();

async function main() {
  loadRootEnv();
  const config = getAppConfig();
  const services = getServiceContainer(prisma, getEventBus(), config);

  const list = await services.agent.list({ page: 1, pageSize: 20, keyword: "assistant" });
  const candidate = list.items.find((a) => a.name === "assistant") ?? list.items[0];
  if (!candidate) {
    console.log("ℹ️ 未找到默认 assistant（首次启动时会自动创建），无需迁移。");
    return;
  }
  // list 按 R19 裁剪了 systemPrompt，漂移检测需要全量实体
  const exact = await services.agent.getById(candidate.id);

  const drift = detectAssistantDrift(exact);
  if (drift.length === 0) {
    console.log(`✅ 默认 assistant（${exact.id}）无配置漂移，无需迁移。`);
    return;
  }

  console.log(`发现默认 assistant（${exact.id}）配置漂移：`);
  for (const d of drift) console.log(`  - ${d}`);

  const tools = Array.isArray(exact.tools) ? exact.tools : [];
  const needsPromptUpdate = !exact.systemPrompt || drift.some((d) => d.includes("系统提示"));
  const updated = await services.agent.update({
    id: exact.id,
    tools: Array.from(new Set([...tools, ...ASSISTANT_DEFAULT_TOOLS])),
    ...(needsPromptUpdate ? { systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT } : {}),
    ...(!exact.tier ? { tier: "manager" as const } : {}),
  });

  if (!updated.success) {
    throw new Error(`迁移失败：${updated.error?.message ?? "未知错误"}`);
  }
  console.log(`✅ 迁移完成：工具 ${tools.length} → ${updated.data!.tools.length} 个` +
    `${needsPromptUpdate ? "；系统提示已升级" : ""}${!exact.tier ? "；tier 已置为 manager" : ""}`);
}

main()
  .catch((e) => {
    console.error("❌ 迁移失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
