/**
 * sync-free-keys.ts — 从 GitHub 免费 API Key 项目同步 key 到 Credential 表
 *
 * 来源：https://github.com/alistaitsacle/free-llm-api-keys
 * 该项目每天 3-5 次更新免费 LLM API Key，兼容 OpenAI SDK 格式。
 * 每个 key 有 $20-$100 预算，24-48 小时后过期。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/sync-free-keys.ts
 * 可加 --watch 定时刷新（每小时）
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GitHub raw URL — free-llm-api-keys 项目的 keys 文件
// 项目：alistaitsacle/free-llm-api-keys，MIT License，每天 3-5 次更新
const FREE_KEYS_URLS = [
  "https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/keys.json",
  "https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/free-keys.json",
];

interface FreeKeyEntry {
  key?: string;
  apiKey?: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  expiresAt?: string;
  budget?: string;
}

async function fetchFreeKeys(): Promise<FreeKeyEntry[]> {
  for (const url of FREE_KEYS_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const data = await res.json();
      // 兼容多种格式：数组、{ keys: [...] }、{ providers: [{ keys: [...] }] }
      let keys: FreeKeyEntry[] = [];
      if (Array.isArray(data)) {
        keys = data;
      } else if (Array.isArray(data.keys)) {
        keys = data.keys;
      } else if (Array.isArray(data.providers)) {
        keys = data.providers.flatMap((p: any) =>
          (p.keys || []).map((k: string) => ({ key: k, provider: p.name, baseUrl: p.baseUrl })),
        );
      } else if (typeof data === "object") {
        // 键值对格式：{ "provider/model": "sk-..." }
        keys = Object.entries(data).map(([model, key]) => ({ key: String(key), model, provider: model.split("/")[0] }));
      }
      if (keys.length > 0) return keys;
    } catch (err) {
      console.warn(`  ⚠️ [sync-free-keys] 从 ${url} 拉取失败:`, err instanceof Error ? err.message : err);
    }
  }
  return [];
}

async function syncFreeKeys(): Promise<void> {
  console.log("🔄 [sync-free-keys] 开始同步免费 API Key...");
  const keys = await fetchFreeKeys();
  if (keys.length === 0) {
    console.warn("  ⚠️ [sync-free-keys] 未获取到任何 key，可能源文件格式变化或网络问题。");
    return;
  }

  let synced = 0;
  let skipped = 0;

  for (const entry of keys) {
    const keyValue = entry.key || entry.apiKey;
    if (!keyValue || typeof keyValue !== "string") { skipped++; continue; }

    const name = `free-${entry.provider ?? "unknown"}-${entry.model ?? "default"}`;
    const metadata = JSON.stringify({
      source: "free",
      provider: entry.provider ?? "unknown",
      model: entry.model,
      baseUrl: entry.baseUrl,
      budget: entry.budget,
      syncedAt: new Date().toISOString(),
    });

    // 检查是否已存在（按 name 查找）
    const existing = await prisma.credential.findFirst({ where: { name } });
    if (existing) {
      // 更新 value + metadata（key 可能已轮换）
      await prisma.credential.update({
        where: { id: existing.id },
        data: { value: keyValue, metadata, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null },
      });
    } else {
      await prisma.credential.create({
        data: {
          name,
          type: "api_key",
          value: keyValue,
          scope: "llm",
          metadata,
          expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
        },
      });
    }
    synced++;
  }

  // 清理过期 key（超过 48 小时未更新的 free key）
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const allFree = await prisma.credential.findMany({ where: { scope: { contains: "llm" } } });
  let cleaned = 0;
  for (const c of allFree) {
    try {
      const meta = JSON.parse(c.metadata || "{}");
      if (meta.source !== "free") continue;
      const syncedAt = meta.syncedAt ? new Date(meta.syncedAt) : c.updatedAt;
      if (syncedAt < cutoff) {
        await prisma.credential.delete({ where: { id: c.id } });
        cleaned++;
      }
    } catch { /* ignore */ }
  }

  console.log(`  ✅ [sync-free-keys] 同步 ${synced} 个 key，跳过 ${skipped}，清理过期 ${cleaned} 个。`);
}

async function main() {
  const watch = process.argv.includes("--watch");
  await syncFreeKeys();
  if (watch) {
    console.log("  👀 [sync-free-keys] 进入定时刷新模式（每 60 分钟）...");
    setInterval(() => void syncFreeKeys(), 60 * 60 * 1000);
  } else {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ [sync-free-keys] 同步失败:", err);
  process.exit(1);
});
