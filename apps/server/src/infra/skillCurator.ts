/**
 * Skill Curator — 生命周期（对标 Hermes agent/curator.py 的确定性部分）
 * active → stale → archive（文件进 .archive，DB enabled=false）；永不硬删。
 */

import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import {
  getSkillUsage,
  isProtectedSkill,
  latestActivityAt,
  listSkillUsage,
  markSkillArchived,
  type SkillUsageRecord,
} from "./skillUsage.js";
import { archiveSkillPackage, parseSkillKind } from "./skillPackage.js";

const STATE_FILE = ".curator_state";

interface CuratorState {
  lastRunAt: string | null;
  lastSummary: string | null;
  runCount: number;
}

function statePath(skillsRoot: string): string {
  return path.join(skillsRoot, STATE_FILE);
}

function readState(skillsRoot: string): CuratorState {
  const p = statePath(skillsRoot);
  if (!fs.existsSync(p)) return { lastRunAt: null, lastSummary: null, runCount: 0 };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CuratorState;
  } catch {
    return { lastRunAt: null, lastSummary: null, runCount: 0 };
  }
}

function writeState(skillsRoot: string, state: CuratorState): void {
  fs.writeFileSync(statePath(skillsRoot), JSON.stringify(state, null, 2), "utf-8");
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

export type CuratorResult = {
  ran: boolean;
  skippedReason?: string;
  staleMarked: string[];
  archived: string[];
};

export async function maybeRunSkillCurator(
  services: ServiceContainer,
  config: AppConfig,
  opts?: { force?: boolean },
): Promise<CuratorResult> {
  const skillsRoot = config.contentPaths.skills;
  const intervalH = config.skills.curatorIntervalHours;
  const state = readState(skillsRoot);
  if (!opts?.force && state.lastRunAt) {
    const hours = (Date.now() - Date.parse(state.lastRunAt)) / (3600 * 1000);
    if (hours < intervalH) {
      return { ran: false, skippedReason: `距上次 curator ${hours.toFixed(1)}h < ${intervalH}h`, staleMarked: [], archived: [] };
    }
  }

  const staleAfter = config.skills.staleAfterDays;
  const archiveAfter = config.skills.archiveAfterDays;
  const usage = listSkillUsage(skillsRoot);
  const staleMarked: string[] = [];
  const archived: string[] = [];

  const list = await services.skill.list({ page: 1, pageSize: 200, enabled: true });
  for (const skill of list.items) {
    const rec: SkillUsageRecord =
      usage[skill.name] ??
      getSkillUsage(skill.name, skillsRoot) ?? {
        state: "active",
        viewCount: 0,
        patchCount: 0,
        createCount: 0,
      };
    if (isProtectedSkill(skill.name, rec)) continue;
    // 仅策展 agent-created procedural（与 Hermes「只碰 agent-created」对齐）
    const meta = skill.metaJson ? (JSON.parse(skill.metaJson) as { agentCreated?: boolean; kind?: string }) : {};
    if (!meta.agentCreated && parseSkillKind(skill.metaJson) !== "procedural") continue;
    if (!rec.agentCreated && !meta.agentCreated) continue;

    const activity = latestActivityAt(rec);
    const idleDays = daysSince(activity);

    if (idleDays >= archiveAfter) {
      const kind = parseSkillKind(skill.metaJson, "executable");
      const result = archiveSkillPackage(skillsRoot, skill.name, kind === "procedural" ? "procedural" : "executable");
      if (result.ok) {
        await services.skill.update({
          id: skill.id,
          enabled: false,
          metaJson: JSON.stringify({
            ...meta,
            archived: true,
            archivedTo: result.archivedTo,
            kind,
          }),
        } as never);
        markSkillArchived(skill.name, skillsRoot);
        archived.push(skill.name);
      }
      continue;
    }

    if (idleDays >= staleAfter && rec.state !== "stale") {
      const file = listSkillUsage(skillsRoot);
      if (file[skill.name]) {
        file[skill.name]!.state = "stale";
        fs.writeFileSync(path.join(skillsRoot, ".usage.json"), JSON.stringify(file, null, 2), "utf-8");
      }
      staleMarked.push(skill.name);
    }
  }

  const summary = `stale=${staleMarked.length} archived=${archived.length}`;
  writeState(skillsRoot, {
    lastRunAt: new Date().toISOString(),
    lastSummary: summary,
    runCount: state.runCount + 1,
  });

  return { ran: true, staleMarked, archived };
}
