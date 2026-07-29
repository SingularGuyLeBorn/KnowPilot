/**
 * 给现有 super/manager/assistant Agent 补齐 native:download_file。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-download-file-tool.ts
 */
import { prisma } from "../db.js";

const TOOL = "native:download_file";

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

function serializeTools(tools: string[], raw: unknown): string {
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    return JSON.stringify(tools);
  }
  if (Array.isArray(raw)) return JSON.stringify(tools);
  return tools.join(",");
}

async function main() {
  const agents = await prisma.agent.findMany({
    where: { OR: [{ tier: { in: ["super", "manager"] } }, { name: "assistant" }] },
    select: { id: true, name: true, tier: true, tools: true },
  });
  let updated = 0;
  for (const agent of agents) {
    const tools = parseTools(agent.tools);
    if (tools.includes(TOOL)) {
      console.log(`skip ${agent.name} (${agent.tier})`);
      continue;
    }
    // 插在 scrape_web_page 后，否则追加末尾
    const idx = tools.indexOf("native:scrape_web_page");
    const next =
      idx >= 0
        ? [...tools.slice(0, idx + 1), TOOL, ...tools.slice(idx + 1)]
        : [...tools, TOOL];
    await prisma.agent.update({
      where: { id: agent.id },
      data: { tools: serializeTools(next, agent.tools) },
    });
    updated += 1;
    console.log(`updated ${agent.name}: +${TOOL}`);
  }
  console.log(`done: ${updated}/${agents.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
