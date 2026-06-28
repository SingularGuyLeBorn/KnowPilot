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
      try {
        const slug = filePathToSlug(contentDir, filePath);
        const mtime = getFileMtime(filePath);
        const { data, content } = parseMarkdownFile(filePath);

        const name = typeof data.name === "string" ? data.name : slug;
        const description = typeof data.description === "string" ? data.description : null;
        const model = typeof data.model === "string" ? data.model : "deepseek-chat";
        const systemPrompt = content.trim();
        const tools = readStringArray(data.tools).join(",");

        records.push({
          slug,
          mtime,
          data: { name, description, model, systemPrompt, tools },
        });
      } catch (e: any) {
        console.error(`  ❌ [Agent 解析失败] ${filePath}:`, e.message);
      }
    }

    return records;
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<AgentData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.agent.upsert({
      where: { name: data.name },
      update: {
        description: data.description,
        model: data.model,
        systemPrompt: data.systemPrompt,
        tools: data.tools,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        description: data.description,
        model: data.model,
        systemPrompt: data.systemPrompt,
        tools: data.tools,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[]): Promise<number> {
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
