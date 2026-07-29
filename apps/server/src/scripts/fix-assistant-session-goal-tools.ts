/**
 * 一次性：给现有 assistant（及缺 goal 工具的 manager）补齐 session_goal_*。
 * resolveAgent 只读化后不会自动补 tools 字段。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-assistant-session-goal-tools.ts
 */
import { prisma } from "../db.js";

const GOAL_TOOLS = [
  "native:session_goal_set",
  "native:session_goal_status",
  "native:session_goal_clear",
  "native:session_goal_pause",
  "native:session_goal_resume",
] as const;

function splitTools(raw: string): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const agents = await prisma.agent.findMany({
    where: {
      OR: [{ name: "assistant" }, { tier: "manager" }, { tier: "super" }],
    },
    select: { id: true, name: true, tier: true, tools: true },
  });

  let patched = 0;
  for (const a of agents) {
    const tools = splitTools(a.tools);
    const missing = GOAL_TOOLS.filter((t) => !tools.includes(t));
    if (missing.length === 0) {
      console.log(`skip ${a.name} (${a.tier}) — 已含 session_goal_*`);
      continue;
    }
    const next = [...tools, ...missing];
    await prisma.agent.update({
      where: { id: a.id },
      data: { tools: next.join(",") },
    });
    patched += 1;
    console.log(`patched ${a.name} (${a.tier}) +${missing.length}: ${missing.join(", ")}`);
  }
  console.log(`done: patched=${patched}/${agents.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
