/**
 * P1-01：从默认 assistant / 超级 Agent 的 tools 剥掉集成 opt-in 清单与 skill:*。
 *
 * 背景：曾把 INTEGRATION_*（飞书/语雀/Coze 等 ~90 项）与 skill:* 打进默认工具面，
 * schema 膨胀。常量侧已瘦身；本脚本幂等清理 DB 里已固化的旧清单。
 *
 * 执行：
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/strip-integration-default-tools.ts
 *
 * 跑完可删本文件（一次性）；也可保留作幂等再跑。
 */
import { PrismaClient } from "@prisma/client";
import { INTEGRATION_OPT_IN_TOOLS } from "@knowpilot/shared";
import { getAppConfig, loadRootEnv } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";

const prisma = new PrismaClient();

const STRIP_SET = new Set<string>([...INTEGRATION_OPT_IN_TOOLS, "skill:*"]);

function asToolList(tools: unknown): string[] {
  if (Array.isArray(tools)) return tools.map(String);
  if (typeof tools === "string") {
    try {
      const parsed = JSON.parse(tools) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stripTools(tools: string[]): { next: string[]; removed: string[] } {
  const removed: string[] = [];
  const next = tools.filter((t) => {
    if (STRIP_SET.has(t)) {
      removed.push(t);
      return false;
    }
    return true;
  });
  return { next, removed };
}

async function main() {
  loadRootEnv();
  const config = getAppConfig();
  const services = getServiceContainer(prisma, getEventBus(), config);
  const list = await services.agent.list({ page: 1, pageSize: 200 });
  const targets = list.items.filter((a) => a.name === "assistant" || a.tier === "super");
  if (targets.length === 0) {
    console.log("ℹ️ 未找到 assistant / super Agent，跳过。");
    return;
  }

  for (const item of targets) {
    const exact = await services.agent.getById(item.id);
    const tools = asToolList(exact.tools);
    const { next, removed } = stripTools(tools);
    if (removed.length === 0) {
      console.log(`✅ 「${exact.name}」（${exact.id}）无需剥离（${tools.length} 工具）。`);
      continue;
    }
    const updated = await services.agent.update({ id: exact.id, tools: next });
    if (!updated.success) {
      throw new Error(`剥离失败 ${exact.id}: ${updated.error?.message ?? "未知"}`);
    }
    console.log(
      `✅ 「${exact.name}」（${exact.id}）：${tools.length} → ${next.length}（剥 ${removed.length}：` +
        `${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""}）`,
    );
  }
}

main()
  .catch((e) => {
    console.error("❌ strip 失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
