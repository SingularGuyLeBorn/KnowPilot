import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countToolCallsForNudge,
  maybeSpawnSkillBackgroundReview,
  shouldNudgeSkillReview,
  __resetSkillReviewLocksForTests,
  SKILL_REVIEW_TOOLS,
  listSkillReviewSideRuns,
} from "../infra/skillBackgroundReview.js";
import {
  archiveSkillPackage,
  inferKindFromScanPath,
  parseSkillKind,
  sanitizeSkillName,
  shouldSkipSkillScanPath,
  skillFileSlug,
} from "../infra/skillPackage.js";
import { bumpSkillView, listSkillUsage, markSkillAgentCreated } from "../infra/skillUsage.js";
import { maybeRunSkillCurator } from "../infra/skillCurator.js";
import { getAllowedToolsForTier } from "../infra/swarmPermissionGuard.js";
import { createTempProjectDir, createTestConfig, makeSkillEntity } from "./helpers/toolTestFixtures.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { buildAgentToolSchemas, parseAgentTools } from "../infra/agentTools.js";

describe("Hermes skill package 约定", () => {
  it("SKILL.md 路径推断 procedural；附属文件跳过扫描", () => {
    expect(inferKindFromScanPath("my-skill/SKILL.md")).toBe("procedural");
    expect(inferKindFromScanPath("flat-skill.md")).toBe("executable");
    expect(shouldSkipSkillScanPath("my-skill/references/api.md")).toBe(true);
    expect(shouldSkipSkillScanPath(".archive/x/SKILL.md")).toBe(true);
    expect(shouldSkipSkillScanPath("my-skill/SKILL.md")).toBe(false);
    expect(skillFileSlug("My Skill", "procedural")).toBe("my-skill/SKILL");
    expect(sanitizeSkillName("Fix PR #123 Today!")).toBe("fix-pr-123-today");
  });

  it("archive 移入 .archive 而非硬删", () => {
    const root = createTempProjectDir();
    const skills = path.join(root, "content", "skills");
    const pkg = path.join(skills, "demo-skill");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "SKILL.md"), "---\nname: demo-skill\nkind: procedural\n---\n# Demo\n");
    const r = archiveSkillPackage(skills, "demo-skill", "procedural");
    expect(r.ok).toBe(true);
    expect(fs.existsSync(pkg)).toBe(false);
    if (r.ok) expect(fs.existsSync(r.archivedTo)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("Hermes progressive disclosure 注册", () => {
  it("procedural 不进 skill__* schema；executable 仍进", async () => {
    const services = {
      skill: {
        list: vi.fn(async () => ({
          items: [
            makeSkillEntity({
              name: "proc",
              metaJson: JSON.stringify({ kind: "procedural" }),
              enabled: true,
            }),
            makeSkillEntity({
              name: "exec",
              code: "function run(i){return i}",
              metaJson: JSON.stringify({ kind: "executable" }),
              enabled: true,
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 200,
          totalPages: 1,
        })),
      },
    };
    const parsed = parseAgentTools(["skill:*", "native:skills_list"]);
    const registry = new Map();
    const schemas = await buildAgentToolSchemas(services as never, parsed, registry);
    const names = schemas.map((s) => s.function.name);
    expect(names).toContain("skills_list");
    expect(names.some((n) => n.startsWith("skill__exec"))).toBe(true);
    expect(names.some((n) => n.includes("proc"))).toBe(false);
  });

  it("tier：sub 可 list/view，不可 manage；manager 可 manage", () => {
    const tools = ["native:skills_list", "native:skill_view", "native:skill_manage", "native:read_file"];
    const sub = getAllowedToolsForTier("sub", tools);
    expect(sub).toContain("native:skills_list");
    expect(sub).toContain("native:skill_view");
    expect(sub).not.toContain("native:skill_manage");
    expect(getAllowedToolsForTier("manager", tools)).toContain("native:skill_manage");
  });
});

describe("Hermes skill_manage / usage / nudge", () => {
  const roots: string[] = [];
  afterEach(() => {
    __resetSkillReviewLocksForTests();
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
    roots.length = 0;
  });

  it("skill_manage create 写出 procedural 包并 bump usage", async () => {
    const root = createTempProjectDir();
    roots.push(root);
    const skillsDir = path.join(root, "content", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const config = createTestConfig(root);
    const createdIds: string[] = [];
    const services = {
      skill: {
        list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })),
        create: vi.fn(async (input: { name: string }) => {
          const id = `id-${input.name}`;
          createdIds.push(id);
          return {
            success: true,
            data: makeSkillEntity({
              id,
              name: input.name,
              metaJson: JSON.stringify({ kind: "procedural" }),
            }),
          };
        }),
        update: vi.fn(async () => ({ success: true, data: {} })),
      },
    };
    const content = `---
name: "class-debug"
description: "Debug class-level workflows carefully."
kind: procedural
---
# Class Debug
## When to Use
- recurring debug class
`;
    const result = (await executeNativeTool(
      "skill_manage",
      { action: "create", name: "class-debug", content },
      { config, services: services as never, invokeTrpc: async () => ({}) },
    )) as { success?: boolean; name?: string; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const md = path.join(skillsDir, "class-debug", "SKILL.md");
    expect(fs.existsSync(md)).toBe(true);
    expect(fs.readFileSync(md, "utf-8")).toContain("Class Debug");
  });

  it("usage sidecar 记录 view；nudge 阈值负向/正向", async () => {
    const root = createTempProjectDir();
    roots.push(root);
    const skillsDir = path.join(root, "content", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    bumpSkillView("demo", skillsDir);
    bumpSkillView("demo", skillsDir);
    markSkillAgentCreated("demo", skillsDir);
    const usage = listSkillUsage(skillsDir);
    expect(usage.demo?.viewCount).toBe(2);
    expect(usage.demo?.agentCreated).toBe(true);

    expect(shouldNudgeSkillReview(3, 10)).toBe(false);
    expect(shouldNudgeSkillReview(10, 10)).toBe(true);
    expect(countToolCallsForNudge([
      { id: "1", name: "read_file", kind: "tool" } as never,
      { id: "2", name: "think", kind: "thinking" } as never,
    ])).toBe(1);

    const runReview = vi.fn(async () => ({}));
    const config = createTestConfig(root, {
      skills: { nudgeInterval: 2, reviewModel: "auto", staleAfterDays: 30, archiveAfterDays: 90, curatorIntervalHours: 1 },
    });
    const spawned = maybeSpawnSkillBackgroundReview({
      config,
      services: {} as never,
      agentId: "a1",
      sessionId: "s1",
      toolCalls: [
        { id: "1", name: "read_file", kind: "tool" } as never,
        { id: "2", name: "web_search", kind: "tool" } as never,
      ],
      runReview,
    });
    expect(spawned).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(runReview).toHaveBeenCalledOnce();

    const notSpawned = maybeSpawnSkillBackgroundReview({
      config: createTestConfig(root, {
        skills: { nudgeInterval: 10, reviewModel: "auto", staleAfterDays: 30, archiveAfterDays: 90, curatorIntervalHours: 1 },
      }),
      services: {} as never,
      agentId: "a1",
      sessionId: "s2",
      toolCalls: [{ id: "1", name: "read_file", kind: "tool" } as never],
      runReview,
    });
    expect(notSpawned).toBe(false);

    expect(SKILL_REVIEW_TOOLS).toEqual([
      "native:skills_list",
      "native:skill_view",
      "native:skill_manage",
    ]);
    const side = await listSkillReviewSideRuns(
      {
        session: {
          list: vi.fn(async () => ({
            items: [
              {
                id: "sr1",
                title: "[skill-review] x",
                status: "completed",
                model: "x:free",
                updatedAt: new Date().toISOString(),
                kind: "skill_review",
              },
            ],
            total: 1,
            page: 1,
            pageSize: 30,
            totalPages: 1,
          })),
        },
      } as never,
      "parent-1",
    );
    expect(side.items).toHaveLength(1);
    expect(side.items[0]!.kind).toBe("skill_review");
    expect(side.items[0]!.status).toBe("completed");
  });

  it("curator 归档闲置 agent-created skill（非硬删）", async () => {
    const root = createTempProjectDir();
    roots.push(root);
    const skillsDir = path.join(root, "content", "skills");
    const pkg = path.join(skillsDir, "old-skill");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "SKILL.md"), "---\nname: old-skill\nkind: procedural\n---\n# Old\n");
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
    fs.writeFileSync(
      path.join(skillsDir, ".usage.json"),
      JSON.stringify({
        "old-skill": {
          state: "active",
          viewCount: 1,
          patchCount: 0,
          createCount: 1,
          agentCreated: true,
          lastViewedAt: old,
          createdAt: old,
        },
      }),
    );
    const config = createTestConfig(root, {
      skills: { nudgeInterval: 10, reviewModel: "auto", staleAfterDays: 30, archiveAfterDays: 90, curatorIntervalHours: 1 },
    });
    const skill = makeSkillEntity({
      id: "sk-old",
      name: "old-skill",
      enabled: true,
      metaJson: JSON.stringify({ kind: "procedural", agentCreated: true }),
    });
    const services = {
      skill: {
        list: vi.fn(async () => ({ items: [skill], total: 1, page: 1, pageSize: 200, totalPages: 1 })),
        update: vi.fn(async () => ({ success: true, data: skill })),
      },
    };
    const r = await maybeRunSkillCurator(services as never, config, { force: true });
    expect(r.ran).toBe(true);
    expect(r.archived).toContain("old-skill");
    expect(fs.existsSync(pkg)).toBe(false);
    expect(fs.existsSync(path.join(skillsDir, ".archive"))).toBe(true);
  });
});

describe("parseSkillKind", () => {
  it("旧 kind=skill 归一为 executable", () => {
    expect(parseSkillKind(JSON.stringify({ kind: "skill" }))).toBe("executable");
    expect(parseSkillKind(JSON.stringify({ kind: "procedural" }))).toBe("procedural");
  });
});
