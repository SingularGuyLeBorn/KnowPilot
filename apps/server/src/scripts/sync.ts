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
import { fileURLToPath } from "url";
import chokidar from "chokidar";
import { PrismaClient } from "@prisma/client";
import { Syncer } from "./sync/types.js";
import { getAppConfig, resolveGardenDir } from "../infra/config.js";
import { getContentDir, filePathToSlug } from "./sync/utils.js";
import { guardedWatchDeleteBySlug } from "./sync/watchDeleteGuard.js";
import { buildPostGardenSyncers } from "./sync/sync-posts.js";
import { gardenSyncer } from "./sync/sync-gardens.js";
import { agentSyncer } from "./sync/sync-agents.js";
import { skillSyncer } from "./sync/sync-skills.js";
import { mcpServerSyncer } from "./sync/sync-mcp-servers.js";
import { memorySyncer } from "./sync/sync-memories.js";
import { promptSyncer } from "./sync/sync-prompts.js";
import { taskSyncer } from "./sync/sync-tasks.js";
import { infoSourceSyncer } from "./sync/sync-info-sources.js";

const prisma = new PrismaClient();

/** 动态组装：Garden 优先，再按 content/ 发现的花园挂 Post syncer */
function buildSyncers(): Syncer<unknown>[] {
  return [
    gardenSyncer,
    ...buildPostGardenSyncers(getAppConfig().contentDir),
    agentSyncer,
    skillSyncer,
    mcpServerSyncer,
    memorySyncer,
    promptSyncer,
    taskSyncer,
    infoSourceSyncer,
  ];
}

/** Post:* 永远走 content/{garden}/，禁止掉进 config/ */
function resolveSyncerDir(syncer: { entityName: string; contentDirName: string }): string {
  if (syncer.entityName === "Garden") return getAppConfig().contentDir;
  if (syncer.entityName.startsWith("Post:")) {
    return resolveGardenDir(getAppConfig(), syncer.contentDirName);
  }
  return getContentDir(syncer.contentDirName);
}

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
async function syncEntity<T>(syncer: Syncer<T>, client: PrismaClient): Promise<SyncResult> {
  const contentDir = resolveSyncerDir(syncer);
  const result: SyncResult = { entityName: syncer.entityName, scanned: 0, upserted: 0, cleaned: 0 };

  if (!fs.existsSync(contentDir)) {
    console.log(`  ⚠️ 目录不存在，跳过: ${contentDir}`);
    return result;
  }

  try {
    const existingMtimes = await syncer.getExistingMtimes(client);
    const records = await syncer.scan(client, contentDir);
    result.scanned = records.length;

    for (const record of records) {
      try {
        const dbMtime = existingMtimes.get(record.slug);
        if (needsSync(record.mtime, dbMtime)) {
          await syncer.upsert(client, record);
          result.upserted++;
        }
      } catch (e: any) {
        console.error(`  ❌ [${syncer.entityName} 同步失败] ${record.slug}:`, e.message);
      }
    }

    const activeSlugs = records.map((r) => r.slug);
    result.cleaned = await syncer.cleanup(client, activeSlugs, contentDir);
  } catch (e: any) {
    console.error(`  ❌ [${syncer.entityName}] 同步过程失败:`, e.message);
  }

  return result;
}

/** 一次性同步所有实体（可被 TaskRunner / CLI / dev 编排复用） */
export async function runContentSync(
  client: PrismaClient = prisma,
  options: { rebuildFts?: boolean } = {},
): Promise<SyncResult[]> {
  console.log(`\n🔄 开始同步本地内容文件至数据库...`);

  const results: SyncResult[] = [];
  for (const syncer of buildSyncers()) {
    console.log(`\n📂 [${syncer.entityName}] 源目录: ${resolveSyncerDir(syncer)}`);
    const result = await syncEntity(syncer, client);
    results.push(result);
    console.log(`  📊 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
  }

  console.log(`\n🎉 内容同步完成！\n`);
  if (options.rebuildFts !== false) {
    try {
      const { rebuildFtsIndex } = await import("../infra/ftsIndex.js");
      await rebuildFtsIndex(client);
    } catch (e: unknown) {
      console.warn("  ⚠️ [FTS] 索引重建跳过:", e instanceof Error ? e.message : e);
    }
  }
  return results;
}

/** 监听模式：增量同步后持续监听变更（不重建 FTS，由 dev 前置 db:sync 负责） */
async function runWatch(): Promise<void> {
  await runContentSync(prisma, { rebuildFts: false });

  console.log(`\n👀 进入监听模式，实时同步 content/ 目录变更...\n`);

  // 防抖键 = `${entityName}:${eventPath}`：同窗口多文件事件（新增 A + 删除 B）各自独立防抖，
  // 不再互相覆盖导致「后一个事件吞掉前一个」而丢同步。
  const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  /** D4 兜底：改名窗口跳过删除后自行调度的全量重扫定时器（entityName 级去重） */
  const fullRescanTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 已挂 watcher 的 Post 花园（contentDirName = garden id），用于新花园去重 */
  const attachedPostGardens = new Set<string>();

  /**
   * D4：改名窗口跳过删除后自行调度一次全量重扫（不再依赖后续文件事件触发）。
   * 不变量：凡跳过删除 ⇒ 必有一次全量重扫排期，残留行必然收敛。
   */
  const scheduleFullRescan = (target: Syncer<unknown>) => {
    if (fullRescanTimers.has(target.entityName)) return;
    fullRescanTimers.set(
      target.entityName,
      setTimeout(() => {
        fullRescanTimers.delete(target.entityName);
        syncEntity(target, prisma)
          .then((result) => {
            console.log(`  📊 [${target.entityName}] 全量重扫（改名窗口保护）: 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
            if (target.entityName === "Garden") attachNewGardenSyncers();
          })
          .catch((e) => console.error(`  ❌ [${target.entityName}] 全量重扫失败:`, e));
      }, 1500),
    );
  };

  /** 新花园发现：为尚未挂载的花园动态挂 Post syncer + watcher，并立即全量同步一次 */
  const attachNewGardenSyncers = () => {
    for (const postSyncer of buildPostGardenSyncers(getAppConfig().contentDir)) {
      if (attachedPostGardens.has(postSyncer.contentDirName)) continue;
      if (!fs.existsSync(resolveSyncerDir(postSyncer))) continue;
      attachedPostGardens.add(postSyncer.contentDirName);
      console.log(`  🌱 [${postSyncer.entityName}] 发现新花园，动态挂载监听`);
      attachWatcher(postSyncer);
      syncEntity(postSyncer, prisma)
        .then((r) =>
          console.log(`  📊 [${postSyncer.entityName}] 新花园首次同步: 扫描 ${r.scanned} 条，同步 ${r.upserted} 条，清理 ${r.cleaned} 条`),
        )
        .catch((e) => console.error(`  ❌ [${postSyncer.entityName}] 新花园首次同步失败:`, e));
    }
  };

  function attachWatcher(syncer: Syncer<unknown>): void {
    const contentDir = resolveSyncerDir(syncer);
    if (!fs.existsSync(contentDir)) return;

    // 忽略点开头与 `_` 开头目录；Garden 特例允许 _garden.md（首页事实源）
    const watcher = chokidar.watch(contentDir, {
      ignored: (p: string) => {
        if (path.basename(p) === "_garden.md") return false;
        return /(^|[/\\])(\.|_)/.test(p);
      },
      persistent: true,
      ignoreInitial: true,
    });

    const triggerSync = (eventPath: string, eventType: string) => {
      const ext = path.extname(eventPath).toLowerCase();
      if (!syncer.extensions.includes(ext)) return;
      // Garden 只认 _garden.md；文章落盘不得拖起全库花园扫描（否则 Goal/autosave 刷爆 watch）
      if (syncer.entityName === "Garden" && path.basename(eventPath) !== "_garden.md") {
        return;
      }

      console.log(`  🔔 [${syncer.entityName}] 检测到${eventType}: ${path.relative(contentDir, eventPath)}`);

      const debounceKey = `${syncer.entityName}:${eventPath}`;
      if (debounceMap.has(debounceKey)) {
        clearTimeout(debounceMap.get(debounceKey));
      }

      debounceMap.set(
        debounceKey,
        setTimeout(async () => {
          debounceMap.delete(debounceKey);

          // A13 + #7：删除事件优先走增量 deleteBySlug（不再全目录扫描）；不支持时回退全量 syncEntity。
          // 新增/变更走单文件 scanFile + upsert。
          if (eventType === "删除") {
            if (syncer.deleteBySlug) {
              try {
                const slug = filePathToSlug(contentDir, eventPath);
                // D4：目标行 5s 内刚 update → 跳过硬删，自行调度全量重扫
                const { deleted, skipped } = await guardedWatchDeleteBySlug(prisma, syncer, slug);
                if (skipped) {
                  console.warn(
                    `  ⚠️ [${syncer.entityName}] 跳过删除 slug=${slug}（行 5s 内刚更新，疑似改名窗口）；已调度全量重扫`,
                  );
                  scheduleFullRescan(syncer);
                  return;
                }
                console.log(`  🗑️ [${syncer.entityName}] 增量清理: ${path.relative(contentDir, eventPath)} (${deleted} 条)`);
              } catch (e: any) {
                console.error(`  ❌ [${syncer.entityName}] 增量清理失败，回退全量:`, e.message);
                const result = await syncEntity(syncer, prisma);
                console.log(`  📊 [${syncer.entityName}] 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
                if (syncer.entityName === "Garden") attachNewGardenSyncers();
              }
            } else {
              const result = await syncEntity(syncer, prisma);
              console.log(`  📊 [${syncer.entityName}] 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
              if (syncer.entityName === "Garden") attachNewGardenSyncers();
            }
          } else if (syncer.scanFile) {
            try {
              const record = await syncer.scanFile(eventPath, contentDir);
              if (record) {
                await syncer.upsert(prisma, record);
                console.log(`  📊 [${syncer.entityName}] 单文件同步: ${path.relative(contentDir, eventPath)}`);
                // 新花园的 _garden.md 落盘 → 动态挂 Post syncer + watcher
                if (syncer.entityName === "Garden") attachNewGardenSyncers();
              }
            } catch (e: any) {
              console.error(`  ❌ [${syncer.entityName}] 单文件同步失败:`, e.message);
            }
          } else {
            const result = await syncEntity(syncer, prisma);
            console.log(`  📊 [${syncer.entityName}] 扫描 ${result.scanned} 条，同步 ${result.upserted} 条，清理 ${result.cleaned} 条`);
            if (syncer.entityName === "Garden") attachNewGardenSyncers();
          }
        }, 1500)
      );
    };

    watcher
      .on("add", (filePath) => triggerSync(filePath, "新增"))
      .on("change", (filePath) => triggerSync(filePath, "变更"))
      .on("unlink", (filePath) => triggerSync(filePath, "删除"))
      .on("error", (error) => console.error(`  ❌ [${syncer.entityName}] 监听错误:`, error));
  }

  // watch：挂 content 根 + 各配置目录；watch 运行期间新建的花园由 Garden 事件触发
  // attachNewGardenSyncers 动态补挂 Post syncer + watcher（见上）。
  for (const syncer of buildSyncers()) {
    if (syncer.entityName.startsWith("Post:")) {
      attachedPostGardens.add(syncer.contentDirName);
    }
    attachWatcher(syncer);
  }
}

const isWatchMode = process.argv.includes("--watch");
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  if (isWatchMode) {
    runWatch()
      .catch((e) => {
        console.error("❌ 监听模式执行失败:", e);
        process.exit(1);
      });
  } else {
    runContentSync()
      .catch((e) => {
        console.error("❌ 同步脚本执行失败:", e);
        process.exit(1);
      })
      .finally(() => prisma.$disconnect());
  }
}
