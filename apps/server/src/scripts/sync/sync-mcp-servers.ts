/**
 * MCP Server 同步器
 *
 * 文件格式：content/mcp/{slug}.yaml 或 {slug}.json
 * 字段：name, transport(stdio|http), command, args, env, url, headers, enabled
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import { Syncer, SyncRecord } from "./types.js";
import { upsertFtsRow, deleteFtsRow } from "../../infra/ftsIndex.js";
import { getFilesRecursive, parseYamlFile, filePathToSlug, readBoolean, getFileMtime } from "./utils.js";

interface McpServerData {
  name: string;
  transport: string;
  command: string;
  args: string; // JSON string
  env: string; // JSON string
  url: string | null;
  headers: string; // JSON string
  enabled: boolean;
}

function parseHeadersOrEnv(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return JSON.stringify(raw);
  return "{}";
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

  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<McpServerData> | null> {
    try {
      const slug = filePathToSlug(contentDir, filePath);
      // 跳过 _ 开头（模板/示例说明）
      if (slug.startsWith("_") || slug.includes("/_")) return null;
      const mtime = getFileMtime(filePath);
      const data =
        filePath.endsWith(".json")
          ? (JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>)
          : parseYamlFile(filePath).data;

      const name = typeof data.name === "string" ? data.name : slug;
      const transport = data.transport === "http" ? "http" : "stdio";
      const command = typeof data.command === "string" ? data.command : "";
      const args = Array.isArray(data.args) ? JSON.stringify(data.args) : "[]";
      const env = parseHeadersOrEnv(data.env);
      const url = typeof data.url === "string" && data.url.trim() ? data.url.trim() : null;
      const headers = parseHeadersOrEnv(data.headers);
      const enabled = readBoolean(data.enabled, true);

      if (transport === "stdio" && !command.trim()) {
        console.error(`  ❌ [MCP Server] ${filePath}: stdio 缺少 command`);
        return null;
      }
      if (transport === "http" && !url) {
        console.error(`  ❌ [MCP Server] ${filePath}: http 缺少 url`);
        return null;
      }

      return {
        slug,
        mtime,
        data: { name, transport, command, args, env, url, headers, enabled },
      };
    } catch (e: any) {
      console.error(`  ❌ [MCP Server 解析失败] ${filePath}:`, e.message);
      return null;
    }
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<McpServerData>): Promise<void> {
    const { slug, mtime, data } = record;

    const row = await prisma.mcpServer.upsert({
      where: { name: data.name },
      update: {
        transport: data.transport,
        command: data.command,
        args: data.args,
        env: data.env,
        url: data.url,
        headers: data.headers,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        transport: data.transport,
        command: data.command,
        args: data.args,
        env: data.env,
        url: data.url,
        headers: data.headers,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
    try {
      await upsertFtsRow(prisma, "mcp", row.id, row.name, row.command ?? "");
    } catch (e) {
      console.warn(`  ⚠️ [McpServer FTS] upsert 失败 slug=${slug}:`, e instanceof Error ? e.message : e);
    }
  },

  async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
    const rows = await prisma.mcpServer.findMany({ where: { sourceSlug: slug }, select: { id: true } });
    const r = await prisma.mcpServer.deleteMany({ where: { sourceSlug: slug } });
    for (const row of rows) {
      try {
        await deleteFtsRow(prisma, "mcp", row.id);
      } catch (e) {
        console.warn(`  ⚠️ [McpServer FTS] delete 失败 id=${row.id}:`, e instanceof Error ? e.message : e);
      }
    }
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
        console.log(`  🗑 [MCP Server 已清理] "${dbServer.sourceSlug}" (本地文件已被删除)`);
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
