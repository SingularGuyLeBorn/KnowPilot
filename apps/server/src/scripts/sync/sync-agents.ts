/**
 * Agent 同步器
 *
 * 文件格式：content/agents/{slug}.md
 * frontmatter: name, description, model, tools
 * 正文：systemPrompt
 */

import { PrismaClient } from "@prisma/client";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, readStringArray, getFileMtime } from "./utils.js";

interface AgentData {
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string;
  tools: string;
}

export const agentSyncer: Syncer<AgentData> = {
  entityName: "Agent",
  contentDirName: "agents",
  extensions: [".md"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<AgentData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".md"]);
    const records: SyncRecord<AgentData>[] = [];
    for (const filePath of filePaths) {
      const r = await this.scanFile!(filePath, contentDir);
      if (r) records.push(r);
    }
    return records;
  },

  // A13：单文件解析
  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<AgentData> | null> {
    try {
      const slug = filePathToSlug(contentDir, filePath);
      const mtime = getFileMtime(filePath);
      const { data, content } = parseMarkdownFile(filePath);

      const name = typeof data.name === "string" ? data.name : slug;
      const description = typeof data.description === "string" ? data.description : null;
      const model = typeof data.model === "string" ? data.model : "deepseek-chat";
      const systemPrompt = content.trim();
      const tools = readStringArray(data.tools).join(",");

      return { slug, mtime, data: { name, description, model, systemPrompt, tools } };
    } catch (e: any) {
      console.error(`  ❌ [Agent 解析失败] ${filePath}:`, e.message);
      return null;
    }
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<AgentData>): Promise<void> {
    const { slug, mtime, data } = record;

    // name 不再 @unique（swarm 允许重名），用 sourceSlug 做 upsert 唯一键
    const existing = await prisma.agent.findFirst({ where: { sourceSlug: slug } });
    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          description: data.description,
          model: data.model,
          systemPrompt: data.systemPrompt,
          tools: data.tools,
          sourceMtime: mtime,
        },
      });
    } else {
      await prisma.agent.create({
        data: {
          name: data.name,
          description: data.description,
          model: data.model,
          systemPrompt: data.systemPrompt,
          tools: data.tools,
          sourceSlug: slug,
          sourceMtime: mtime,
        },
      });
    }
  },

  // #7：unlink 增量硬删 by sourceSlug
  async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
    const r = await prisma.agent.deleteMany({ where: { sourceSlug: slug } });
    return r.count;
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[], _contentDir?: string): Promise<number> {
    if (activeSlugs.length === 0) {
      console.warn(`  ⚠️ [Agent] activeSlugs 为空，跳过 cleanup 以防误删。`);
      return 0;
    }
    const allInDb = await prisma.agent.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const dbAgent of allInDb) {
      if (dbAgent.sourceSlug && !activeSlugs.includes(dbAgent.sourceSlug)) {
        await prisma.agent.delete({ where: { id: dbAgent.id } });
        console.log(`  🗑️ [Agent 已清理] "${dbAgent.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.agent.findMany({
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
