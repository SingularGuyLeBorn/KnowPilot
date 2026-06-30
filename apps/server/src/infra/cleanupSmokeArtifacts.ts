/**
 * 清理 Vitest / E2E smoke 残留在 content/ 与 dev.db 中的实体
 */
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import {
  isSmokeAgentName,
  isSmokeContentSlug,
  isSmokeInfoSource,
} from "./smokeArtifacts.js";

export interface CleanupSmokeArtifactsResult {
  filesRemoved: number;
  dbRecordsRemoved: number;
  files: string[];
  db: string[];
}

function removeMatchingFiles(dir: string, matcher: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!matcher(name)) continue;
    const abs = path.join(dir, name);
    fs.rmSync(abs, { force: true });
    removed.push(abs);
  }
  return removed;
}

export async function cleanupSmokeArtifacts(opts: {
  projectRoot: string;
  prisma: PrismaClient;
}): Promise<CleanupSmokeArtifactsResult> {
  const contentRoot = path.join(opts.projectRoot, "content");
  const fileRemoved: string[] = [];

  const dirs: Array<{ dir: string; matcher: (name: string) => boolean }> = [
    { dir: path.join(contentRoot, "sources"), matcher: (n) => /^smoke-source-\d+\.json$/i.test(n) },
    { dir: path.join(contentRoot, "posts"), matcher: (n) => /^smoke-post-\d+\.md$/i.test(n) },
    { dir: path.join(contentRoot, "prompts"), matcher: (n) => /^smoke-prompt-\d+\.md$/i.test(n) },
    { dir: path.join(contentRoot, "skills"), matcher: (n) => /^smoke_skill_[a-z0-9]+\.md$/i.test(n) },
    { dir: path.join(contentRoot, "mcp"), matcher: (n) => /^smoke_mcp_[a-z0-9]+\.(json|ya?ml)$/i.test(n) },
    { dir: path.join(contentRoot, "agents"), matcher: (n) => /^Smoke Agent \d+\.md$/i.test(n) },
    { dir: path.join(contentRoot, "uploads"), matcher: (n) => /^vitest-test-file-/i.test(n) },
  ];

  for (const { dir, matcher } of dirs) {
    fileRemoved.push(...removeMatchingFiles(dir, matcher));
  }

  const dbRemoved: string[] = [];

  const sources = await opts.prisma.infoSource.findMany({ select: { id: true, name: true, sourceSlug: true } });
  for (const row of sources) {
    if (isSmokeInfoSource(row.name, row.sourceSlug)) {
      await opts.prisma.infoSource.delete({ where: { id: row.id } });
      dbRemoved.push(`InfoSource:${row.sourceSlug ?? row.name}`);
    }
  }

  const posts = await opts.prisma.post.findMany({ select: { id: true, slug: true } });
  for (const row of posts) {
    if (isSmokeContentSlug(row.slug)) {
      await opts.prisma.post.delete({ where: { id: row.id } });
      dbRemoved.push(`Post:${row.slug}`);
    }
  }

  const agents = await opts.prisma.agent.findMany({ select: { id: true, name: true, sourceSlug: true } });
  for (const row of agents) {
    if (isSmokeAgentName(row.name) || (row.sourceSlug && isSmokeContentSlug(row.sourceSlug))) {
      await opts.prisma.agent.delete({ where: { id: row.id } });
      dbRemoved.push(`Agent:${row.sourceSlug ?? row.name}`);
    }
  }

  return {
    filesRemoved: fileRemoved.length,
    dbRecordsRemoved: dbRemoved.length,
    files: fileRemoved.map((p) => path.relative(opts.projectRoot, p)),
    db: dbRemoved,
  };
}
