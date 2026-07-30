/**
 * 一次性：给现有 super/manager（含 assistant）补齐 agent_cron_* 三工具。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-agent-cron-tools.ts
 */
import { prisma } from "../db.js";

const NEED = [
  "native:agent_cron_set",
  "native:agent_cron_list",
  "native:agent_cron_clear",
] as const;

async function main() {
  const agents = await prisma.agent.findMany({
    where: { tier: { in: ["super", "manager"] }, status: { not: "deleted" } },
    select: { id: true, name: true, tools: true, tier: true },
  });
  let patched = 0;
  for (const a of agents) {
    const list = (a.tools ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const missing = NEED.filter((t) => !list.includes(t));
    if (missing.length === 0) {
      console.log(`skip ${a.tier} ${a.name}`);
      continue;
    }
    const next = [...list, ...missing].join(",");
    await prisma.agent.update({ where: { id: a.id }, data: { tools: next } });
    patched++;
    console.log(`patched ${a.tier} ${a.name}: +${missing.join(",")}`);
  }
  console.log(`done: patched=${patched}/${agents.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
