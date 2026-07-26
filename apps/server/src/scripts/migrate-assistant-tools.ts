/**
 * 默认 assistant / 超级 Agent 配置迁移脚本（幂等，可重复执行）
 *
 * 背景（W9）：resolveAgent 只读，不再在读路径静默补齐工具/提示词。
 * 本脚本是显式修复入口：
 *   1. assistant：合并 ASSISTANT_DEFAULT_TOOLS；默认身份提示词缺 garden 或旧版 → 升级为当前默认
 *   2. tier=super：合并 TIER_DEFAULT_TOOLS.super；提示词缺 garden_create → 追加「知识库花园」段
 *
 * 执行：
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-assistant-tools.ts
 */
import { PrismaClient } from "@prisma/client";
import { ASSISTANT_DEFAULT_TOOLS, TIER_DEFAULT_TOOLS } from "@knowpilot/shared";
import { getAppConfig, loadRootEnv } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import {
  detectAssistantDrift,
  DEFAULT_ASSISTANT_SYSTEM_PROMPT,
} from "../infra/agentResolver.js";

const GARDEN_PROMPT_SECTION = `

## 知识库花园（铁律）
可动态新建第 N 座知识库：\`native:garden_create\`（id+title+首页）→ \`content/{id}/_garden.md\`；列表/详情/改首页用 \`garden_list\` / \`garden_get\` / \`garden_update\`；空库可 \`garden_delete\`（种子 \`posts\` / \`knowledge\` / \`resources\` 不可删）。写文章用 \`post_create\` / \`post_update\`（\`garden\` 须已存在，默认 \`posts\`）；列文章 \`post_list\`。**禁止 \`write_file\` 直写 \`content/\`**（除 \`uploads/\`）。
`.trimEnd();

const prisma = new PrismaClient();

function asToolList(tools: unknown): string[] {
  if (Array.isArray(tools)) return tools.map(String);
  if (typeof tools === "string") {
    try {
      const parsed = JSON.parse(tools) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function migrateAssistant(services: ReturnType<typeof getServiceContainer>) {
  const list = await services.agent.list({ page: 1, pageSize: 20, keyword: "assistant" });
  const candidate = list.items.find((a) => a.name === "assistant") ?? list.items[0];
  if (!candidate) {
    console.log("ℹ️ 未找到默认 assistant（首次启动时会自动创建），跳过 assistant。");
    return;
  }
  const exact = await services.agent.getById(candidate.id);
  const drift = detectAssistantDrift(exact);
  if (drift.length === 0) {
    console.log(`✅ 默认 assistant（${exact.id}）无配置漂移。`);
    return;
  }

  console.log(`发现默认 assistant（${exact.id}）配置漂移：`);
  for (const d of drift) console.log(`  - ${d}`);

  const tools = asToolList(exact.tools);
  const needsPromptUpdate = drift.some((d) => d.includes("系统提示"));
  const updated = await services.agent.update({
    id: exact.id,
    tools: Array.from(new Set([...tools, ...ASSISTANT_DEFAULT_TOOLS])),
    ...(needsPromptUpdate ? { systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT } : {}),
    ...(!exact.tier ? { tier: "manager" as const } : {}),
  });

  if (!updated.success) {
    throw new Error(`assistant 迁移失败：${updated.error?.message ?? "未知错误"}`);
  }
  console.log(
    `✅ assistant 迁移完成：工具 ${tools.length} → ${updated.data!.tools.length} 个` +
      `${needsPromptUpdate ? "；系统提示已升级" : ""}`,
  );
}

async function migrateSuperAgents(services: ReturnType<typeof getServiceContainer>) {
  const list = await services.agent.list({ page: 1, pageSize: 100 });
  const supers = list.items.filter((a) => a.tier === "super");
  if (supers.length === 0) {
    console.log("ℹ️ 未找到超级 Agent，跳过。");
    return;
  }

  for (const item of supers) {
    const exact = await services.agent.getById(item.id);
    const tools = asToolList(exact.tools);
    const missing = TIER_DEFAULT_TOOLS.super.filter((t) => !tools.includes(t));
    const prompt = exact.systemPrompt || "";
    const needsGardenPrompt = !prompt.includes("garden_create");
    if (missing.length === 0 && !needsGardenPrompt) {
      console.log(`✅ 超级 Agent「${exact.name}」（${exact.id}）工具与花园指引已齐。`);
      continue;
    }

    const nextTools = Array.from(new Set([...tools, ...TIER_DEFAULT_TOOLS.super]));
    const nextPrompt = needsGardenPrompt
      ? `${prompt.trimEnd()}\n${GARDEN_PROMPT_SECTION}\n`
      : undefined;

    console.log(
      `修复超级 Agent「${exact.name}」（${exact.id}）：缺工具 ${missing.length}；` +
        `${needsGardenPrompt ? "追加花园指引" : "提示词已含花园"}`,
    );

    const updated = await services.agent.update({
      id: exact.id,
      tools: nextTools,
      ...(nextPrompt ? { systemPrompt: nextPrompt } : {}),
    });
    if (!updated.success) {
      throw new Error(`超级 Agent 迁移失败：${updated.error?.message ?? "未知错误"}`);
    }
    console.log(
      `✅ 超级 Agent 迁移完成：工具 ${tools.length} → ${updated.data!.tools.length} 个` +
        `${needsGardenPrompt ? "；已追加知识库花园段" : ""}`,
    );
  }
}

async function main() {
  loadRootEnv();
  const config = getAppConfig();
  const services = getServiceContainer(prisma, getEventBus(), config);
  await migrateAssistant(services);
  await migrateSuperAgents(services);
}

main()
  .catch((e) => {
    console.error("❌ 迁移失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
