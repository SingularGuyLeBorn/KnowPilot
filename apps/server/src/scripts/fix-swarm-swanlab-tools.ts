/**
 * 给现有 super/manager/assistant 补齐 swarm harness + swanlab 工具。
 * pnpm --filter @knowpilot/server exec tsx src/scripts/fix-swarm-swanlab-tools.ts
 */
import { prisma } from "../db.js";

const EXTRA = [
  "native:swarm_export_trace",
  "native:swarm_stage_write",
  "native:swarm_stage_list",
  "native:swarm_stage_read",
  "native:swanlab_status",
  "native:swanlab_user_info",
  "native:swanlab_project_list",
  "native:swanlab_project_create",
  "native:swanlab_run_list",
  "native:swanlab_run_info",
  "native:swanlab_run_summary",
  "native:swanlab_run_metrics",
  "native:swanlab_run_series",
  "native:swanlab_scaffold_train",
];

function parseTools(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        /* fallthrough */
      }
    }
    return s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

async function main() {
  const agents = await prisma.agent.findMany({
    where: { OR: [{ tier: { in: ["super", "manager"] } }, { name: "assistant" }] },
    select: { id: true, name: true, tier: true, tools: true },
  });
  let updated = 0;
  for (const agent of agents) {
    const tools = parseTools(agent.tools);
    const missing = EXTRA.filter((t) => !tools.includes(t));
    if (!missing.length) {
      console.log(`skip ${agent.name}`);
      continue;
    }
    const next = [...tools, ...missing].join(",");
    await prisma.agent.update({ where: { id: agent.id }, data: { tools: next } });
    updated += 1;
    console.log(`updated ${agent.name}: +${missing.length}`);
  }
  console.log(`done ${updated}/${agents.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
