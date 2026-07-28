/**
 * 一次性：给现有 super/manager/assistant Agent 补齐 session_goal_* 工具。
 * resolveAgent 只读化后不会自动补 tools 字段。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-agent-goal-tools.ts
 */

import { prisma } from "../db.js";

const GOAL_TOOLS = [
  "native:session_goal_set",
  "native:session_goal_status",
  "native:session_goal_clear",
  "native:session_goal_pause",
  "native:session_goal_resume",
] as const;

function parseTools(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw.trim()) return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  }
  return t
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeTools(tools: string[], raw: unknown): string {
  if (Array.isArray(raw)) return JSON.stringify(tools);
  if (typeof raw === "string" && raw.trim().startsWith("[")) return JSON.stringify(tools);
  return tools.join(",");
}

async function main() {
  const agents = await prisma.agent.findMany({
    where: {
      status: { not: "deleted" },
      OR: [{ tier: { in: ["super", "manager"] } }, { name: "assistant" }],
    },
    select: { id: true, name: true, tier: true, tools: true },
  });

  let updated = 0;
  for (const a of agents) {
    const tools = parseTools(a.tools);
    const missing = GOAL_TOOLS.filter((t) => !tools.includes(t));
    if (missing.length === 0) {
      console.log(`skip ${a.name} (${a.tier})`);
      continue;
    }
    const next = [...tools, ...missing];
    await prisma.agent.update({
      where: { id: a.id },
      data: { tools: serializeTools(next, a.tools) },
    });
    console.log(`+ ${a.name} (${a.tier}): ${missing.join(", ")}`);
    updated++;
  }
  console.log(`done: ${updated}/${agents.length} updated`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
