/**
 * sync-free-keys.ts — 从 GitHub 免费 API Key 项目同步 key 到 Credential 表
 *
 * 来源：https://github.com/alistaitsacle/free-llm-api-keys
 * 该项目每天 3-5 次更新免费 LLM API Key，符合 OpenAI SDK 格式。
 * 每个 key 有 $20-$100 预算，24-48 小时后过期。
 *
 * key 列表写在 README.md 的 markdown 表格里（非 JSON 文件），格式：
 *   | Key | Model | Status | Budget | Rate Limit | Expires | Description |
 *   | --- | --- | --- | --- | --- | --- | --- |
 *   | `sk-xxx` | model | 🆕 New | $20 | 5 RPM | 2026-07-08 | desc |
 *
 * 所有 key 共用 Base URL：https://aiapiv2.pekpik.com/v1
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/sync-free-keys.ts
 * 可加 --watch 定时刷新（每小时）
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 所有 key 共用的 OpenAI 协议端点
const FREE_KEYS_BASE_URL = "https://aiapiv2.pekpik.com/v1";

// 可通过环境变量配置代理前缀（国内访问 raw.githubusercontent.com 常被墙）
// 例如：FREE_KEYS_PROXY=https://ghproxy.net/
const PROXY = process.env.FREE_KEYS_PROXY ?? "";
const withProxy = (url: string) => (PROXY ? `${PROXY.replace(/\/$/, "")}/${url}` : url);

// 拉取源：优先 README.md（当前唯一真实来源），保留 JSON 兜底以防格式回退
// 注意：alistaitsacle/free-llm-api-keys 于 2026-07-08 被 GitHub 以 ToS 为由封禁，
// raw URL 可能返回 404 / API 返回 403。如仓库恢复或换镜像，改这里即可。
const FREE_KEYS_SOURCES: { url: string; kind: "readme" | "json" }[] = [
  {
    url: withProxy(
      "https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/README.md",
    ),
    kind: "readme",
  },
  {
    url: withProxy(
      "https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/keys.json",
    ),
    kind: "json",
  },
  {
    url: withProxy(
      "https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/free-keys.json",
    ),
    kind: "json",
  },
];

// 本地文件兜底：如果网络源全部失败，可手动下载 README.md 放到本地，通过
// FREE_KEYS_LOCAL_FILE 环境变量指定路径（如 content/free-keys-readme.md）
const LOCAL_FILE = process.env.FREE_KEYS_LOCAL_FILE ?? "";

interface FreeKeyEntry {
  key: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  budget?: string;
  rateLimit?: string;
  status?: string;
  description?: string;
  expiresAt?: string;
}

/**
 * 从 README.md 文本解析 key 表格行。
 * 匹配形如 `| \`sk-xxx\` | model | status | $20 | 5 RPM | 2026-07-08 | desc |` 的行。
 */
function parseReadmeKeys(md: string): FreeKeyEntry[] {
  const entries: FreeKeyEntry[] = [];
  // 匹配数据行：以 | 开头，第一列是 `sk-xxx`（反引号包裹的 key）
  const rowRe = /\|\s*`((?:sk-)?[A-Za-z0-9_\-]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(md)) !== null) {
    const key = m[1].trim();
    // 跳过表头 / 分隔行（key 列不是 sk- 开头的实际 key）
    if (!/^sk-/.test(key)) continue;
    const model = m[2].trim();
    const status = m[3].trim();
    const budget = m[4].trim();
    const rateLimit = m[5].trim();
    const expires = m[6].trim();
    const description = m[7].trim();
    // provider 从 model 推断：google/gemini-xxx → google；claude-opus-4-7 → claude（无斜线取首段）
    const provider = model.includes("/") ? model.split("/")[0] : model.split("-")[0];
    entries.push({
      key,
      model: model || undefined,
      provider: provider || undefined,
      baseUrl: FREE_KEYS_BASE_URL,
      budget: budget || undefined,
      rateLimit: rateLimit || undefined,
      status: status || undefined,
      description: description || undefined,
      expiresAt: parseExpiresDate(expires),
    });
  }
  return entries;
}

/** 把 "2026-07-08" 或 "2026-07-08 16:37" 解析成 ISO 字符串（当天结束） */
function parseExpiresDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  // 仅日期 → 当天 23:59:59 UTC；带时间 → 直接用
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T23:59:59Z`;
  }
  // 带时间但无时区，按 UTC 处理
  return /Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
}

/** 解析上游仓库出现过的多种 JSON 形态（数组 / {keys:[]} / {providers:[{keys:[]}]} / 键值对） */
function parseJsonKeys(data: unknown): FreeKeyEntry[] {
  const out: FreeKeyEntry[] = [];
  const push = (k: Partial<FreeKeyEntry> & { key?: string; apiKey?: string }) => {
    const keyValue = k.key || k.apiKey;
    if (typeof keyValue === "string" && /^sk-/.test(keyValue)) {
      out.push({
        key: keyValue,
        model: k.model,
        provider: k.provider,
        baseUrl: k.baseUrl || FREE_KEYS_BASE_URL,
        budget: k.budget,
        expiresAt: k.expiresAt,
      });
    }
  };
  if (Array.isArray(data)) {
    data.forEach(push);
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.keys)) {
      d.keys.forEach(push);
    } else if (Array.isArray(d.providers)) {
      d.providers.forEach((p) => {
        if (p && typeof p === "object") {
          const prov = p as Record<string, unknown>;
          if (Array.isArray(prov.keys)) {
            prov.keys.forEach((k) =>
              push({
                key: typeof k === "string" ? k : undefined,
                provider: typeof prov.name === "string" ? prov.name : undefined,
                baseUrl: typeof prov.baseUrl === "string" ? prov.baseUrl : undefined,
              }),
            );
          }
        }
      });
    } else {
      // 键值对：{ "provider/model": "sk-..." }
      Object.entries(d).forEach(([model, key]) => {
        if (typeof key === "string") {
          push({ key, model, provider: model.split("/")[0] });
        }
      });
    }
  }
  return out;
}

async function fetchFreeKeys(): Promise<FreeKeyEntry[]> {
  for (const src of FREE_KEYS_SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        console.warn(`  ⚠️ [sync-free-keys] ${src.url} -> HTTP ${res.status}`);
        continue;
      }
      if (src.kind === "readme") {
        const md = await res.text();
        const keys = parseReadmeKeys(md);
        if (keys.length > 0) {
          console.log(`  📄 [sync-free-keys] 从 README.md 解析到 ${keys.length} 个 key`);
          return keys;
        }
        console.warn(`  ⚠️ [sync-free-keys] README.md 解析到 0 个 key，尝试下一个源`);
      } else {
        const data = await res.json();
        const keys = parseJsonKeys(data);
        if (keys.length > 0) {
          console.log(`  📦 [sync-free-keys] 从 ${src.url} 解析到 ${keys.length} 个 key`);
          return keys;
        }
      }
    } catch (err) {
      console.warn(
        `  ⚠️ [sync-free-keys] 从 ${src.url} 拉取失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 本地文件兜底
  if (LOCAL_FILE) {
    try {
      const { readFileSync } = await import("node:fs");
      const raw = readFileSync(LOCAL_FILE, "utf-8");
      const keys = parseReadmeKeys(raw);
      if (keys.length > 0) {
        console.log(`  📁 [sync-free-keys] 从本地文件 ${LOCAL_FILE} 解析到 ${keys.length} 个 key`);
        return keys;
      }
      // 也试 JSON
      try {
        const data = JSON.parse(raw);
        const jsonKeys = parseJsonKeys(data);
        if (jsonKeys.length > 0) {
          console.log(`  📁 [sync-free-keys] 从本地文件 ${LOCAL_FILE} 解析到 ${jsonKeys.length} 个 key`);
          return jsonKeys;
        }
      } catch {
        /* 不是 JSON，忽略 */
      }
      console.warn(`  ⚠️ [sync-free-keys] 本地文件 ${LOCAL_FILE} 解析到 0 个 key`);
    } catch (err) {
      console.warn(
        `  ⚠️ [sync-free-keys] 读取本地文件 ${LOCAL_FILE} 失败:`,
        err instanceof Error ? err.message : err,
      );
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

  // 去重：同一 key 值只保留一条（README 可能跨 section 重复）
  const seen = new Set<string>();
  const deduped = keys.filter((k) => {
    if (seen.has(k.key)) return false;
    seen.add(k.key);
    return true;
  });

  let synced = 0;
  let updated = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();

  for (const entry of deduped) {
    if (!entry.key) {
      skipped++;
      continue;
    }

    // name 用 key 值本身保证唯一（同一 key 轮换时 upsert 而非新建）
    const name = `free-${entry.provider ?? "unknown"}-${entry.model ?? "default"}-${entry.key.slice(-8)}`;
    const metadata = JSON.stringify({
      source: "free",
      provider: entry.provider ?? "unknown",
      model: entry.model,
      baseUrl: entry.baseUrl ?? FREE_KEYS_BASE_URL,
      budget: entry.budget,
      rateLimit: entry.rateLimit,
      status: entry.status,
      description: entry.description,
      syncedAt: nowIso,
    });

    const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;

    const existing = await prisma.credential.findFirst({ where: { name } });
    if (existing) {
      await prisma.credential.update({
        where: { id: existing.id },
        data: { value: entry.key, metadata, expiresAt },
      });
      updated++;
    } else {
      await prisma.credential.create({
        data: {
          name,
          type: "api_key",
          value: entry.key,
          scope: "llm",
          metadata,
          expiresAt,
        },
      });
      synced++;
    }
  }

  // 清理过期 key：超过 48 小时未更新的 free key 视为已过期
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
    } catch {
      /* ignore */
    }
  }

  console.log(
    `  ✅ [sync-free-keys] 新增 ${synced}，更新 ${updated}，跳过 ${skipped}，清理过期 ${cleaned} 个。`,
  );
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
