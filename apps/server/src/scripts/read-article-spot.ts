/**
 * 单 URL read_article 快速验证（真实网络，无 mock）
 * 用法: pnpm --filter @knowpilot/server read-article:spot <url>
 */

import { formatToolResultHint } from "@knowpilot/shared";
import { loadRootEnv, getAppConfig } from "../infra/config.js";
import { executeNativeTool, syncSearchEnvFromConfig } from "../infra/nativeTools.js";
import { closeBrowser } from "../infra/metablog/index.js";
import { prisma } from "../db.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";

loadRootEnv();
const config = getAppConfig();
syncSearchEnvFromConfig(config);

const url = process.argv[2]?.trim();
if (!url) {
  console.error("用法: pnpm read-article:spot <url>");
  process.exit(1);
}

const eventBus = getEventBus();
const services = getServiceContainer(prisma, eventBus, config);
const ctx = { config, services, invokeTrpc: async () => ({}) };

async function main() {
  const started = Date.now();
  const raw = await executeNativeTool(
    "read_article",
    { url, timeout: 45000, embedOcr: false, maxChars: 12000 },
    ctx,
  );
  const row = raw as Record<string, unknown>;
  console.log(JSON.stringify({ ms: Date.now() - started, ...row, content: undefined, preview: String(row.content ?? "").slice(0, 300) }, null, 2));
  const hint = formatToolResultHint(raw);
  if (hint) console.log(`[hint] ${hint}`);
}

main()
  .catch((err) => {
    console.error("❌", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => {
    void closeBrowser().catch(() => undefined);
    void prisma.$disconnect().catch(() => undefined);
  });
