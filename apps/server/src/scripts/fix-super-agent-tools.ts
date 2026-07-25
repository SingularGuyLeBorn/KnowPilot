/**
 * 一次性脚本：给现有 super/manager tier Agent 的 tools 字段补齐 platform_login + browser_login_status。
 *
 * 根因：TIER_DEFAULT_TOOLS.super/manager 之前没含 platform_login，已创建的超级 Agent 的 tools 字段固化了旧清单，
 * resolveAgent 只读化（W9）不自动补齐，导致超级 Agent 拿不到 platform_login 工具。
 * 本脚本运行后可删（数据迁移走一次性脚本，不留代码分支）。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-super-agent-tools.ts
 */
import { prisma } from "../db.js";

const TOOLS_TO_ADD = ["native:platform_login", "native:browser_login_status"];

async function main() {
  const agents = await prisma.agent.findMany({
    where: { tier: { in: ["super", "manager"] } },
    select: { id: true, name: true, tier: true, tools: true },
  });
  console.log(`找到 ${agents.length} 个 super/manager Agent`);

  let updated = 0;
  for (const agent of agents) {
    const current = (agent.tools || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const missing = TOOLS_TO_ADD.filter((t) => !current.includes(t));
    if (missing.length === 0) continue;
    const next = [...current, ...missing].join(",");
    await prisma.agent.update({ where: { id: agent.id }, data: { tools: next } });
    updated++;
    console.log(`  ✓ ${agent.name} (${agent.tier}) 补齐 ${missing.join(", ")}`);
  }
  console.log(`完成：${updated}/${agents.length} 个 Agent 已补齐 platform_login/browser_login_status`);
}

main()
  .catch((err) => {
    console.error("脚本失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
