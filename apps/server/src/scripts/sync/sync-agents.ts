/**
 * Agent 同步器
 *
 * 文件格式：config/agents/{slug}.md
 * frontmatter: name, description, model, tools
 * 正文：systemPrompt
 */

import { PrismaClient } from "@prisma/client";
import { LLM_MODEL_IDS } from "@knowpilot/shared";
import { upsertFtsRow, deleteFtsRow } from "../../infra/ftsIndex.js";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, readStringArray, getFileMtime } from "./utils.js";

interface AgentData {
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string;
  tools: string;
  tier: string;
  source: string | null;
}

export const agentSyncer: Syncer<AgentData> = {
  entityName: "Agent",
  contentDirName: "agents",
  extensions: [".md"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<AgentData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".md"]);
    const records: SyncRecord<AgentData>[] = [];
    // 同名文件防 flip-flop：name-fallback 会把同名文件当同一行交替覆写 systemPrompt/tools，
    // scan 阶段直接 warn 跳过后者，保证同步结果确定
    const seenNames = new Set<string>();
    for (const filePath of filePaths) {
      const r = await this.scanFile!(filePath, contentDir);
      if (!r) continue;
      if (seenNames.has(r.data.name)) {
        console.warn(`  ⚠️ [Agent 跳过] ${filePath}: 名称 "${r.data.name}" 与同目录其他文件重复`);
        continue;
      }
      seenNames.add(r.data.name);
      records.push(r);
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
      const model = typeof data.model === "string" ? data.model : LLM_MODEL_IDS.DEEPSEEK_CHAT;
      const systemPrompt = content.trim();
      const tools = readStringArray(data.tools).join(",");
      const tier = typeof data.tier === "string" ? data.tier : "sub";
      const source = typeof data.source === "string" ? data.source : null;

      return { slug, mtime, data: { name, description, model, systemPrompt, tools, tier, source } };
    } catch (e: any) {
      console.error(`  ❌ [Agent 解析失败] ${filePath}:`, e.message);
      return null;
    }
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<AgentData>): Promise<void> {
    const { slug, mtime, data } = record;

    // 1. 按 sourceSlug 精确匹配（正常路径）
    let existing = await prisma.agent.findFirst({ where: { sourceSlug: slug } });
    // 2. 防御：sourceSlug 未匹配时按 name 兜底，避免历史遗留 sourceSlug=null 的记录被重复创建
    //    （曾导致超级 Agent 每次 sync 复制一份）。
    //    收窄：只匹配 sourceSlug 为空的运行时 Agent——文件源 Agent 必有 sourceSlug，
    //    不收窄会把同名不同源的文件 Agent 误合并成一行互相覆写。
    if (!existing) {
      existing = await prisma.agent.findFirst({
        where: { name: data.name, status: { not: "deleted" }, sourceSlug: null },
      });
    }
    // 3. 全局唯一 super 守卫：Service 层拦截可被 sync 直写绕过，
    //    config/agents/ 出现第二个 tier: super 文件时跳过而非创建第二个超级 Agent
    if (data.tier === "super") {
      const liveSuper = await prisma.agent.findFirst({
        where: { tier: "super", status: { not: "deleted" } },
        select: { id: true },
      });
      if (liveSuper && liveSuper.id !== existing?.id) {
        console.warn(`  ⚠️ [Agent 跳过] ${slug}: 文件声明 tier=super，但已存在超级 Agent（全局唯一）`);
        return;
      }
    }
    let rowId: string;
    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          description: data.description,
          model: data.model,
          systemPrompt: data.systemPrompt,
          tools: data.tools,
          tier: data.tier,
          source: data.source,
          sourceSlug: slug,
          sourceMtime: mtime,
        },
      });
      rowId = existing.id;
    } else {
      const created = await prisma.agent.create({
        data: {
          name: data.name,
          description: data.description,
          model: data.model,
          systemPrompt: data.systemPrompt,
          tools: data.tools,
          tier: data.tier,
          source: data.source,
          sourceSlug: slug,
          sourceMtime: mtime,
        },
      });
      rowId = created.id;
    }

    const live = await prisma.agent.findUnique({
      where: { id: rowId },
      select: { id: true, name: true, description: true, systemPrompt: true, status: true },
    });
    if (live && live.status !== "deleted") {
      try {
        await upsertFtsRow(prisma, "agent", live.id, live.name, `${live.description ?? ""}\n${live.systemPrompt ?? ""}`);
      } catch (e) {
        console.warn(`  ⚠️ [Agent FTS] upsert 失败 slug=${slug}:`, e instanceof Error ? e.message : e);
      }
    }
  },

  // #7：unlink 增量硬删 by sourceSlug
  async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
    const rows = await prisma.agent.findMany({ where: { sourceSlug: slug }, select: { id: true } });
    const r = await prisma.agent.deleteMany({ where: { sourceSlug: slug } });
    for (const row of rows) {
      try {
        await deleteFtsRow(prisma, "agent", row.id);
      } catch (e) {
        console.warn(`  ⚠️ [Agent FTS] delete 失败 id=${row.id}:`, e instanceof Error ? e.message : e);
      }
    }
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
