/**
 * 一次性脚本：给现有 super/manager tier Agent 的 tools 字段补齐 read_article + scrape_web_page。
 *
 * 根因：TIER_DEFAULT_TOOLS.super/manager 之前没含 read_article/scrape_web_page，
 * 超级 Agent 被要求读文章时只能用 browser_screenshot 截图 → 被知乎反爬拦截。
 * 本脚本运行后可删。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-super-agent-read-article.ts
 */
import { prisma } from "../db.js";

const TOOLS_TO_ADD = ["native:read_article", "native:scrape_web_page"];

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
  console.log(`完成：${updated}/${agents.length} 个 Agent 已补齐 read_article/scrape_web_page`);
}

main()
  .catch((err) => { console.error("脚本失败:", err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
