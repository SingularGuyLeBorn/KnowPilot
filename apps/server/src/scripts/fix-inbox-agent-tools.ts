/**
 * 给现有 super/manager/assistant Agent 补齐 inbox_* 工具（含 enrich / platform_sync）。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-inbox-agent-tools.ts
 */
import { prisma } from "../db.js";

const INBOX_TOOLS = [
  "native:inbox_list",
  "native:inbox_stats",
  "native:inbox_capture_url",
  "native:inbox_capture_urls",
  "native:inbox_start_platform_sync",
  "native:inbox_platform_sync_status",
  "native:inbox_cancel_platform_sync",
  "native:inbox_sync_zhihu",
  "native:inbox_sync_xhs",
  "native:inbox_sync_bilibili",
  "native:inbox_scan_screenshots",
  "native:inbox_ingest_wechat",
  "native:inbox_enrich",
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
    return s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function serializeTools(tools: string[], raw: unknown): string | object {
  // 保持与原存储形态一致：JSON 数组字符串 / 逗号串 / 真数组
  if (Array.isArray(raw)) return tools;
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    return JSON.stringify(tools);
  }
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
    const missing = INBOX_TOOLS.filter((t) => !tools.includes(t));
    if (!missing.length) {
      console.log(`skip ${agent.name} (${agent.tier})`);
      continue;
    }
    const nextTools = [...tools, ...missing];
    const serialized = serializeTools(nextTools, agent.tools);
    await prisma.agent.update({
      where: { id: agent.id },
      data: { tools: typeof serialized === "string" ? serialized : JSON.stringify(serialized) },
    });
    // 若 Agent 是 FileSync 实体，同步会从 md 覆写——同时尽量改 md frontmatter 由用户侧已有；
    // 这里以 DB 为准让当前会话立刻可用。
    updated += 1;
    console.log(`updated ${agent.name}: +${missing.join(", ")}`);
  }
  console.log(`done: ${updated}/${agents.length}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
