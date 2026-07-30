/**
 * 清空全部 AgentCronJob，只保留超级 Agent「知乎面经」每天 08:00 briefing cron。
 * pnpm --filter @knowpilot/server exec tsx src/scripts/setup-zhihu-cron-8am.ts
 */
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import {
  deleteCronJob,
  ensureAgentCronJobTable,
  listCronJobs,
  upsertCronJob,
} from "../infra/agentCronStore.js";

const NEED = [
  "native:agent_cron_set",
  "native:agent_cron_list",
  "native:agent_cron_clear",
  "native:session_spawn_goal",
] as const;

async function main() {
  await ensureAgentCronJobTable(prisma);
  const before = await listCronJobs(prisma);
  console.log(`清空前: ${before.length} 条`);
  for (const r of before) {
    await deleteCronJob(prisma, { id: r.id });
    console.log(`  已删 ${r.name}`);
  }

  const superA = await prisma.agent.findFirst({
    where: { tier: "super", status: { not: "deleted" } },
    select: { id: true, name: true, tools: true, model: true },
  });
  if (!superA) throw new Error("未找到超级 Agent");

  const list = (superA.tools ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = NEED.filter((t) => !list.includes(t));
  if (missing.length) {
    await prisma.agent.update({
      where: { id: superA.id },
      data: { tools: [...list, ...missing].join(",") },
    });
    console.log(`已补齐工具: ${missing.join(",")}`);
  }

  const defaultModel = getAppConfig().llm.defaultModel || superA.model || "deepseek-chat";
  const prompt = [
    "## Briefing 专用",
    "",
    "摸清 `llm-interview` 花园与 bus 现状后，写出今日完整执行 prompt，然后必须调用：",
    "",
    "```ts",
    "session_spawn_goal({",
    `  model: "${defaultModel}",`,
    '  mode: "goal",',
    '  title: "知乎面经日搜 · " + 今日日期,',
    '  prompt: "<你写的完整执行说明>",',
    "})",
    "```",
    "",
    "### 执行说明须包含",
    "",
    "- 按 `config/prompts/zhihu-llm-interview-collect.md`",
    "- `zhihu_openapi_search(scope=zhihu)` 搜「大模型 面试」等关键词",
    "- 最多深读 8 篇、整理最多 15 题 → 花园 `llm-interview`",
    "- 公式用 `$…$`；缺 `ZHIHU_ACCESS_SECRET` 则停并告知",
    "- 结束后更新花园首页并 `write_file` 更新 bus",
    "",
    "> 本 briefing 会话禁止亲自搜题入库。",
  ].join("\n");

  const row = await upsertCronJob(prisma, {
    agentId: superA.id,
    name: "zhihu-llm-interview-daily",
    cron: "0 8 * * *",
    prompt,
    busPath: "cron-bus/zhihu-interview-state.md",
    enabled: true,
  });

  const after = await listCronJobs(prisma);
  console.log(
    `完成: ${superA.name} / ${row.name} / ${row.cron} / model提示=${defaultModel} / 共 ${after.length} 条`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
