/**
 * Markdown / YAML ↔ SQLite 同步编译脚本
 *
 * 扫描 content/ 目录下各实体的源文件，解析后同步写入 SQLite 数据库。
 * 本地 Markdown/YAML 文件是数据的唯一事实源。
 *
 * 支持两种模式：
 * 1. 一次性全量/增量同步（默认）
 * 2. --watch 监听模式：先做一遍增量同步，然后监听文件变更实时同步
 */

import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { PrismaClient } from "@prisma/client";
import { Syncer } from "./sync/types.js";
import { getContentDir } from "./sync/utils.js";
import { postSyncer } from "./sync/sync-posts.js";
import { agentSyncer } from "./sync/sync-agents.js";
import { skillSyncer } from "./sync/sync-skills.js";
import { mcpServerSyncer } from "./sync/sync-mcp-servers.js";
import { memorySyncer } from "./sync/sync-memories.js";
import { promptSyncer } from "./sync/sync-prompts.js";

const prisma = new PrismaClient();

// 所有已注册的实体同步器（L2 已接入 Agent/Skill/MCP/Memory/Prompt；L3-L4 逐步扩展）
const syncers: Syncer<unknown>[] = [
  postSyncer,
  agentSyncer,
  skillSyncer,
  mcpServerSyncer,
  memorySyncer,
  promptSyncer,
];

interface SyncResult {
  entityName: string;
  scanned: number;
  upserted: number;
  cleaned: number;
}

/**
 * 判断文件是否需要同步：
 * - 数据库无记录 → 需要
 * - 本地 mtime 晚于数据库 sourceMtime → 需要
 */
function needsSync(recordMtime: Date, existingMtime?: Date): boolean {
  if (!existingMtime) return true;
  return recordMtime.getTime() > existingMtime.getTime();
}

/** 同步单个实体（增量），返回统计 */
async function syncEntity<T>(syncer: Syncer<T>): Promise<SyncResult> {
  const contentDir = getContentDir(syncer.contentDirName);
  const result: SyncResult = { entityName: syncer.entityName, scanned: 0, upserted: 0, cleaned: 0 };

  if (!fs.existsSync(contentDir)) {
    console.log(`  ⚠️ 目录不存在，跳过: ${contentDir}`);
    return result;
  }

  try {
    const existingMtimes = await syncer.getExistingMtimes(prisma);
    const records = await syncer.scan(prisma, contentDir);
    result.scanned = records.length;

    for (const record of records) {
      try {
        const dbMtime = existingMtimes.get(record.slug);
        if (needsSync(record.mtime, dbMtime)) {
          await syncer.upsert(prisma, record);
          result.upserted++;
        }
      } catch (e: any) {
        console.error(`  ❌ [${syncer.entityName} 同步失败] ${record.slug}:`, e.message);
      }
    }

    const activeSlugs = records.map((r) => r.slug);
    result.cleaned = await syncer.cleanup(prisma, activeSlugs);
  } catch (e: any) {
    console.error(`  ❌ [${syncer.entityName}] 同步过程失败:`, e.message);
  }

  return result;
}

/** 一次性同步所有实体 */
async function runSync(): Promise<SyncResult[]> {
  console.log(`\n🔄 开始同步本地内容文件至数据库...`);

  const results: SyncResult[] = [];
  for (const syncer of syncers) {
    console.log(`\n📂 [${syncer.entityName}] 源目录: ${getContentDir(syncer.contentDirName)}`);
    const result = await syncEntity(syncer);
    results.push(result);
    console.log(`  📊 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
  }

  console.log(`\n🎉 内容同步完成！\n`);
  return results;
}

/** 监听模式：增量同步后持续监听变更 */
async function runWatch(): Promise<void> {
  await runSync();

  console.log(`\n👀 进入监听模式，实时同步 content/ 目录变更...\n`);

  const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

  for (const syncer of syncers) {
    const contentDir = getContentDir(syncer.contentDirName);
    if (!fs.existsSync(contentDir)) continue;

    const watcher = chokidar.watch(contentDir, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    const triggerSync = (eventPath: string, eventType: string) => {
      const ext = path.extname(eventPath).toLowerCase();
      if (!syncer.extensions.includes(ext)) return;

      console.log(`  🔔 [${syncer.entityName}] 检测到${eventType}: ${path.relative(contentDir, eventPath)}`);

      if (debounceMap.has(syncer.entityName)) {
        clearTimeout(debounceMap.get(syncer.entityName));
      }

      debounceMap.set(
        syncer.entityName,
        setTimeout(async () => {
          const result = await syncEntity(syncer);
          console.log(`  📊 [${syncer.entityName}] 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
        }, 300)
      );
    };

    watcher
      .on("add", (filePath) => triggerSync(filePath, "新增"))
      .on("change", (filePath) => triggerSync(filePath, "变更"))
      .on("unlink", (filePath) => triggerSync(filePath, "删除"))
      .on("error", (error) => console.error(`  ❌ [${syncer.entityName}] 监听错误:`, error));
  }
}

const isWatchMode = process.argv.includes("--watch");

if (isWatchMode) {
  runWatch()
    .catch((e) => {
      console.error("❌ 监听模式执行失败:", e);
      process.exit(1);
    });
} else {
  runSync()
    .catch((e) => {
      console.error("❌ 同步脚本执行失败:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
