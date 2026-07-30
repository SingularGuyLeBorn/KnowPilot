/**
 * 给现有 tier=sub Agent 补齐 session_goal_* 五工具。
 * pnpm --filter @knowpilot/server exec tsx src/scripts/fix-sub-agent-goal-tools.ts
 */
import { prisma } from "../db.js";

const NEED = [
  "native:session_goal_set",
  "native:session_goal_status",
  "native:session_goal_clear",
  "native:session_goal_pause",
  "native:session_goal_resume",
] as const;

async function main() {
  const agents = await prisma.agent.findMany({
    where: { tier: "sub", status: { not: "deleted" } },
    select: { id: true, name: true, tools: true },
  });
  console.log(`扫描 sub Agent: ${agents.length} 个`);
  let patched = 0;
  for (const a of agents) {
    const list = (a.tools ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const missing = NEED.filter((t) => !list.includes(t));
    if (missing.length === 0) {
      console.log(`  skip  ${a.name}`);
      continue;
    }
    await prisma.agent.update({
      where: { id: a.id },
      data: { tools: [...list, ...missing].join(",") },
    });
    patched++;
    console.log(`  patch ${a.name}: +${missing.join(",")}`);
  }
  console.log(`done: patched=${patched}/${agents.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
