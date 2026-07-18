/**
 * Skill 使用遥测 sidecar（对标 Hermes tools/skill_usage.py）
 * 路径：content/skills/.usage.json — 不进 SKILL.md，best-effort。
 */

import fs from "fs";
import path from "path";
import { getAppConfig } from "./config.js";

export type SkillUsageState = "active" | "stale" | "archived" | "pinned";

export interface SkillUsageRecord {
  state: SkillUsageState;
  viewCount: number;
  patchCount: number;
  createCount: number;
  lastViewedAt?: string;
  lastPatchedAt?: string;
  createdAt?: string;
  agentCreated?: boolean;
  protected?: boolean;
}

type UsageFile = Record<string, SkillUsageRecord>;

function usagePath(skillsRoot?: string): string {
  const root = skillsRoot ?? getAppConfig().contentPaths.skills;
  return path.join(root, ".usage.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function readUsage(skillsRoot?: string): UsageFile {
  const p = usagePath(skillsRoot);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as UsageFile;
  } catch {
    return {};
  }
}

function writeUsage(data: UsageFile, skillsRoot?: string): void {
  const p = usagePath(skillsRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

function ensureRecord(file: UsageFile, name: string): SkillUsageRecord {
  if (!file[name]) {
    file[name] = {
      state: "active",
      viewCount: 0,
      patchCount: 0,
      createCount: 0,
      createdAt: nowIso(),
    };
  }
  return file[name]!;
}

export function getSkillUsage(name: string, skillsRoot?: string): SkillUsageRecord | null {
  return readUsage(skillsRoot)[name] ?? null;
}

export function listSkillUsage(skillsRoot?: string): UsageFile {
  return readUsage(skillsRoot);
}

export function bumpSkillView(name: string, skillsRoot?: string): void {
  try {
    const file = readUsage(skillsRoot);
    const rec = ensureRecord(file, name);
    if (rec.state === "archived") return;
    rec.viewCount += 1;
    rec.lastViewedAt = nowIso();
    if (rec.state === "stale") rec.state = "active";
    writeUsage(file, skillsRoot);
  } catch (err) {
    console.debug("[skillUsage] bumpSkillView failed:", err instanceof Error ? err.message : err);
  }
}

export function bumpSkillPatch(name: string, skillsRoot?: string): void {
  try {
    const file = readUsage(skillsRoot);
    const rec = ensureRecord(file, name);
    rec.patchCount += 1;
    rec.lastPatchedAt = nowIso();
    if (rec.state === "stale") rec.state = "active";
    writeUsage(file, skillsRoot);
  } catch (err) {
    console.debug("[skillUsage] bumpSkillPatch failed:", err instanceof Error ? err.message : err);
  }
}

export function markSkillAgentCreated(name: string, skillsRoot?: string): void {
  try {
    const file = readUsage(skillsRoot);
    const rec = ensureRecord(file, name);
    rec.agentCreated = true;
    rec.createCount += 1;
    rec.createdAt = rec.createdAt ?? nowIso();
    writeUsage(file, skillsRoot);
  } catch (err) {
    console.debug("[skillUsage] markSkillAgentCreated failed:", err instanceof Error ? err.message : err);
  }
}

export function markSkillArchived(name: string, skillsRoot?: string): void {
  try {
    const file = readUsage(skillsRoot);
    const rec = ensureRecord(file, name);
    rec.state = "archived";
    writeUsage(file, skillsRoot);
  } catch (err) {
    console.debug("[skillUsage] markSkillArchived failed:", err instanceof Error ? err.message : err);
  }
}

export function latestActivityAt(rec: SkillUsageRecord): string | null {
  const candidates = [rec.lastViewedAt, rec.lastPatchedAt, rec.createdAt].filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  return candidates.sort().at(-1) ?? null;
}

/** 受保护 skill：curator 永不归档（与 Hermes PROTECTED_BUILTIN 同精神） */
export const PROTECTED_SKILL_NAMES = new Set<string>(["plan"]);

export function isProtectedSkill(name: string, rec?: SkillUsageRecord | null): boolean {
  if (PROTECTED_SKILL_NAMES.has(name)) return true;
  if (rec?.protected || rec?.state === "pinned") return true;
  return false;
}
