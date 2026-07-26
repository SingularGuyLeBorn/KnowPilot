/**
 * 一次性：给现有 super/manager/assistant Agent 补齐 inbox_* 工具。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-inbox-agent-tools.ts
 */
import { prisma } from "../db.js";

const INBOX_TOOLS = [
  "native:inbox_list",
  "native:inbox_stats",
  "native:inbox_capture_url",
  "native:inbox_capture_urls",
  "native:inbox_sync_zhihu",
  "native:inbox_sync_xhs",
  "native:inbox_scan_screenshots",
  "native:inbox_ingest_wechat",
  "native:inbox_distill",
  "native:inbox_ignore",
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
    return s.split(",").map((t) => t.trim()).filter(Boolean);
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
    const missing = INBOX_TOOLS.filter((t) => !tools.includes(t));
    if (!missing.length) {
      console.log(`skip ${agent.name} (${agent.tier})`);
      continue;
    }
    const next = [...tools, ...missing].join(",");
    await prisma.agent.update({
      where: { id: agent.id },
      data: { tools: next },
    });
    updated += 1;
    console.log(`updated ${agent.name}: +${missing.length}`);
  }
  console.log(`done: ${updated}/${agents.length}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
