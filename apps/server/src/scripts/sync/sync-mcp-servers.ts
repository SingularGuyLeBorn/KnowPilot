/**
 * MCP Server 同步器
 *
 * 文件格式：content/mcp/{slug}.yaml 或 {slug}.json
 * 字段：name, command, args, env, enabled
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseYamlFile, filePathToSlug, readBoolean, getFileMtime } from "./utils.js";

interface McpServerData {
  name: string;
  command: string;
  args: string; // JSON string
  env: string; // JSON string
  enabled: boolean;
}

export const mcpServerSyncer: Syncer<McpServerData> = {
  entityName: "McpServer",
  contentDirName: "mcp",
  extensions: [".yaml", ".yml", ".json"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<McpServerData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".yaml", ".yml", ".json"]);
    const records: SyncRecord<McpServerData>[] = [];
    for (const filePath of filePaths) {
      const r = await this.scanFile!(filePath, contentDir);
      if (r) records.push(r);
    }
    return records;
  },

  // A13：单文件解析
  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<McpServerData> | null> {
    try {
      const slug = filePathToSlug(contentDir, filePath);
      const mtime = getFileMtime(filePath);
      const data =
        filePath.endsWith(".json")
          ? (JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>)
          : parseYamlFile(filePath).data;

      const name = typeof data.name === "string" ? data.name : slug;
      const command = typeof data.command === "string" ? data.command : "";
      const args = Array.isArray(data.args) ? JSON.stringify(data.args) : "[]";
      const env = data.env && typeof data.env === "object" ? JSON.stringify(data.env) : "{}";
      const enabled = readBoolean(data.enabled, true);

      return { slug, mtime, data: { name, command, args, env, enabled } };
    } catch (e: any) {
      console.error(`  ❌ [MCP Server 解析失败] ${filePath}:`, e.message);
      return null;
    }
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<McpServerData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.mcpServer.upsert({
      where: { name: data.name },
      update: {
        command: data.command,
        args: data.args,
        env: data.env,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        command: data.command,
        args: data.args,
        env: data.env,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  // #7：unlink 增量硬删 by sourceSlug
  async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
    const r = await prisma.mcpServer.deleteMany({ where: { sourceSlug: slug } });
    return r.count;
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[], _contentDir?: string): Promise<number> {
    if (activeSlugs.length === 0) {
      console.warn(`  ⚠️ [MCP Server] activeSlugs 为空，跳过 cleanup 以防误删。`);
      return 0;
    }
    const allInDb = await prisma.mcpServer.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const dbServer of allInDb) {
      if (dbServer.sourceSlug && !activeSlugs.includes(dbServer.sourceSlug)) {
        await prisma.mcpServer.delete({ where: { id: dbServer.id } });
        console.log(`  🗑️ [MCP Server 已清理] "${dbServer.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.mcpServer.findMany({
      select: { sourceSlug: true, sourceMtime: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      if (row.sourceSlug && row.sourceMtime) {
        map.set(row.sourceSlug, row.sourceMtime);
      }
    }
    return map;
  },
};
