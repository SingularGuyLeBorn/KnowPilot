/**
 * 一次性：给现有 super/manager/assistant/sub Agent 补齐软删工具清单。
 * resolveAgent 只读化后不会自动补 tools 字段。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-soft-delete-tools.ts
 */
import { prisma } from "../db.js";

const SOFT_DELETE_TOOLS = [
  "native:file_delete",
  "native:directory_delete",
  "native:trash_list",
  "native:trash_restore",
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
      OR: [
        { name: "assistant" },
        { tier: "manager" },
        { tier: "super" },
        { tier: "sub" },
      ],
    },
    select: { id: true, name: true, tier: true, tools: true },
  });

  let patched = 0;
  for (const a of agents) {
    const tools = splitTools(a.tools);
    const missing = SOFT_DELETE_TOOLS.filter((t) => !tools.includes(t));
    if (missing.length === 0) {
      console.log(`skip ${a.name} (${a.tier}) — 已含 soft-delete tools`);
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
