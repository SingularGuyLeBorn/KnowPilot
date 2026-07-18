/**
 * Native Skills 域 — Hermes 式渐进披露 + skill_manage
 * skills_list / skill_view / skill_manage
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";
import {
  archiveSkillPackage,
  inferKindFromScanPath,
  listSkillLinkedFiles,
  parseSkillKind,
  readSkillSupportFile,
  sanitizeSkillName,
  skillMdPath,
  skillPackageDir,
  truncateSkillDescription,
  writeSkillSupportFile,
  type SkillKind,
} from "../../skillPackage.js";
import {
  bumpSkillPatch,
  bumpSkillView,
  markSkillAgentCreated,
  markSkillArchived,
} from "../../skillUsage.js";

function skillsRoot(ctx: NativeToolContext): string {
  return ctx.config.contentPaths.skills;
}

function parseMeta(metaJson?: string | null): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    return JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function skillsListTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const keyword = args.keyword ? String(args.keyword).toLowerCase() : "";
  const includeDisabled = args.includeDisabled === true;
  const list = await ctx.services.skill.list({
    page: 1,
    pageSize: 200,
    enabled: includeDisabled ? undefined : true,
    keyword: keyword || undefined,
  });
  const skills = list.items
    .map((s) => {
      const kind = parseSkillKind(s.metaJson, "executable");
      if (kind === "reference") return null;
      const desc = truncateSkillDescription(s.description || "", 60);
      return {
        name: s.name,
        description: desc,
        trigger: s.trigger,
        kind,
        enabled: s.enabled,
      };
    })
    .filter(Boolean);
  return {
    count: skills.length,
    skills,
    hint: "需要全文时用 skill_view(name)；程序记忆用 skill_manage 维护。procedural 技能不注册为 skill__* 工具。",
  };
}

async function skillViewTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const name = String(args.name || "").trim();
  if (!name) return { error: "skill_view 需要 name" };
  const filePath = args.file_path ? String(args.file_path) : args.filePath ? String(args.filePath) : "";
  const list = await ctx.services.skill.list({ page: 1, pageSize: 200, keyword: name });
  const skill = list.items.find((s) => s.name === name || sanitizeSkillName(s.name) === sanitizeSkillName(name));
  if (!skill) return { error: `Skill「${name}」不存在` };

  const kind = parseSkillKind(skill.metaJson, "executable");
  const root = skillsRoot(ctx);

  if (filePath) {
    if (kind !== "procedural") {
      return { error: "仅 procedural 包支持 file_path 附属文件" };
    }
    const read = readSkillSupportFile(root, skill.name, filePath);
    if (!read.ok) return { error: read.error };
    bumpSkillView(skill.name, root);
    return {
      name: skill.name,
      kind,
      file_path: filePath,
      content: read.content,
    };
  }

  bumpSkillView(skill.name, root);
  const linked = kind === "procedural" ? listSkillLinkedFiles(root, skill.name) : undefined;
  return {
    name: skill.name,
    id: skill.id,
    description: skill.description,
    trigger: skill.trigger,
    kind,
    enabled: skill.enabled,
    content: skill.code,
    linked_files: linked,
    hint: linked
      ? "可用 skill_view(name, file_path='references/...') 加载附属文件。"
      : undefined,
  };
}

function buildProceduralFrontmatter(opts: {
  name: string;
  description: string;
  version?: string;
}): string {
  const desc = truncateSkillDescription(opts.description || "Procedural skill.", 60);
  return [
    "---",
    `name: "${opts.name.replace(/"/g, '\\"')}"`,
    `description: "${desc.replace(/"/g, '\\"')}"`,
    `kind: procedural`,
    `enabled: true`,
    `version: "${opts.version || "0.1.0"}"`,
    `author: "KnowPilot"`,
    "---",
    "",
  ].join("\n");
}

function splitSkillMd(raw: string): { frontmatter: string; body: string; full: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    return { frontmatter: "", body: raw, full: raw };
  }
  return { frontmatter: m[1]!, body: m[2]!, full: raw };
}

async function upsertProceduralSkill(
  ctx: NativeToolContext,
  name: string,
  fullMd: string,
  opts?: { agentCreated?: boolean },
) {
  const safe = sanitizeSkillName(name);
  if (!safe) return { error: "无效 skill name" };
  const { body } = splitSkillMd(fullMd);
  const descMatch = fullMd.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  const description = truncateSkillDescription(descMatch?.[1] || safe, 60);
  const root = skillsRoot(ctx);
  const dir = skillPackageDir(root, safe);
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, "SKILL.md");
  const content = fullMd.includes("---")
    ? fullMd
    : buildProceduralFrontmatter({ name: safe, description }) + body;
  fs.writeFileSync(mdPath, content.endsWith("\n") ? content : content + "\n", "utf-8");

  const metaJson = JSON.stringify({
    kind: "procedural" satisfies SkillKind,
    version: "0.1.0",
    agentCreated: opts?.agentCreated === true,
    package: true,
  });

  const existing = await ctx.services.skill.list({ page: 1, pageSize: 50, keyword: safe });
  const hit = existing.items.find((s) => sanitizeSkillName(s.name) === safe);
  if (hit) {
    const updated = await ctx.services.skill.update({
      id: hit.id,
      name: safe,
      description,
      code: splitSkillMd(content).body.trim(),
      enabled: true,
      metaJson,
    } as never);
    if (!updated.success) return { error: updated.error?.message ?? "更新失败" };
    return { success: true, skillId: hit.id, name: safe, action: "updated" as const };
  }

  const created = await ctx.services.skill.create({
    name: safe,
    description,
    code: splitSkillMd(content).body.trim(),
    icon: "Sparkles",
    enabled: true,
    metaJson,
  } as never);
  if (!created.success || !created.data) {
    return { error: created.error?.message ?? "创建失败" };
  }
  // 强制写包路径（Service 默认可能写扁平文件）
  const flat = skillMdPath(root, safe, "executable");
  if (fs.existsSync(flat) && flat !== mdPath) {
    try {
      fs.unlinkSync(flat);
    } catch {
      /* ignore */
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mdPath, content.endsWith("\n") ? content : content + "\n", "utf-8");
  await ctx.services.skill.update({
    id: created.data.id,
    metaJson,
  } as never).catch(() => {});
  if (opts?.agentCreated) markSkillAgentCreated(safe, root);
  return { success: true, skillId: created.data.id, name: safe, action: "created" as const };
}

async function skillManageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const action = String(args.action || "");
  const name = sanitizeSkillName(String(args.name || ""));
  if (!name) return { error: "skill_manage 需要合法 name（小写连字符）" };
  const root = skillsRoot(ctx);
  const agentCreatedOrigin = ctx.agentSnapshot?.id
    ? String((ctx as { memoryWriteOrigin?: string }).memoryWriteOrigin || "") === "background_review" ||
      Boolean((ctx as { skillReviewOrigin?: boolean }).skillReviewOrigin)
    : false;

  if (action === "create") {
    const content = String(args.content || "");
    if (!content.trim()) return { error: "create 需要完整 SKILL.md content（frontmatter + body）" };
    const result = await upsertProceduralSkill(ctx, name, content, { agentCreated: agentCreatedOrigin || true });
    if ("error" in result && result.error) return result;
    markSkillAgentCreated(name, root);
    return {
      ...result,
      message: `Skill「${name}」已创建（procedural 包）。用 skills_list / skill_view 加载。`,
    };
  }

  if (action === "edit") {
    const content = String(args.content || "");
    if (!content.trim()) return { error: "edit 需要完整 SKILL.md content" };
    const result = await upsertProceduralSkill(ctx, name, content);
    if ("error" in result && result.error) return result;
    bumpSkillPatch(name, root);
    return { ...result, message: `Skill「${name}」已全文重写。` };
  }

  if (action === "patch") {
    const oldString = String(args.old_string ?? args.oldString ?? "");
    const newString = String(args.new_string ?? args.newString ?? "");
    if (!oldString) return { error: "patch 需要 old_string" };
    const filePath = args.file_path ? String(args.file_path) : args.filePath ? String(args.filePath) : "";
    if (filePath) {
      const read = readSkillSupportFile(root, name, filePath);
      if (!read.ok) return { error: read.error };
      if (!read.content.includes(oldString)) {
        return { error: "old_string 未在目标文件中找到（请先 skill_view）" };
      }
      const replaceAll = args.replace_all === true || args.replaceAll === true;
      const next = replaceAll
        ? read.content.split(oldString).join(newString)
        : read.content.replace(oldString, newString);
      const written = writeSkillSupportFile(root, name, filePath, next);
      if (!written.ok) return { error: written.error };
      bumpSkillPatch(name, root);
      return { success: true, name, file_path: filePath, message: "附属文件已 patch。" };
    }
    const list = await ctx.services.skill.list({ page: 1, pageSize: 50, keyword: name });
    const skill = list.items.find((s) => sanitizeSkillName(s.name) === name);
    if (!skill) return { error: `Skill「${name}」不存在` };
    const kind = parseSkillKind(skill.metaJson, "executable");
    const mdPath = skillMdPath(root, name, kind === "procedural" ? "procedural" : "executable");
    let raw = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf-8") : skill.code;
    if (!raw.includes(oldString) && !skill.code.includes(oldString)) {
      return { error: "old_string 未找到。请先 skill_view 再 patch。" };
    }
    const replaceAll = args.replace_all === true || args.replaceAll === true;
    const target = raw.includes(oldString) ? raw : skill.code;
    const next = replaceAll ? target.split(oldString).join(newString) : target.replace(oldString, newString);
    if (kind === "procedural" || fs.existsSync(path.join(skillPackageDir(root, name), "SKILL.md"))) {
      const full = next.startsWith("---")
        ? next
        : buildProceduralFrontmatter({ name, description: skill.description }) + next;
      fs.mkdirSync(skillPackageDir(root, name), { recursive: true });
      fs.writeFileSync(path.join(skillPackageDir(root, name), "SKILL.md"), full, "utf-8");
      await ctx.services.skill.update({
        id: skill.id,
        code: splitSkillMd(full).body.trim(),
      } as never);
    } else {
      await ctx.services.skill.update({ id: skill.id, code: next } as never);
    }
    bumpSkillPatch(name, root);
    return { success: true, name, message: "SKILL.md 已 patch。" };
  }

  if (action === "write_file") {
    const filePath = String(args.file_path ?? args.filePath ?? "");
    const fileContent = String(args.file_content ?? args.fileContent ?? "");
    if (!filePath) return { error: "write_file 需要 file_path" };
    const written = writeSkillSupportFile(root, name, filePath, fileContent);
    if (!written.ok) return { error: written.error };
    bumpSkillPatch(name, root);
    return { success: true, name, file_path: filePath, message: "附属文件已写入。" };
  }

  if (action === "remove_file") {
    const filePath = String(args.file_path ?? args.filePath ?? "");
    const read = readSkillSupportFile(root, name, filePath);
    if (!read.ok) return { error: read.error };
    fs.unlinkSync(read.absPath);
    bumpSkillPatch(name, root);
    return { success: true, name, file_path: filePath, message: "附属文件已删除。" };
  }

  if (action === "delete") {
    const list = await ctx.services.skill.list({ page: 1, pageSize: 50, keyword: name });
    const skill = list.items.find((s) => sanitizeSkillName(s.name) === name);
    if (!skill) return { error: `Skill「${name}」不存在` };
    const kind = parseSkillKind(skill.metaJson, "executable");
    const archived = archiveSkillPackage(root, name, kind === "procedural" ? "procedural" : "executable");
    if (!archived.ok) return { error: archived.error };
    // DB：禁用并标记归档，不硬删（可恢复）
    const meta = parseMeta(skill.metaJson);
    meta.archived = true;
    meta.archivedTo = archived.archivedTo;
    meta.kind = kind;
    await ctx.services.skill.update({
      id: skill.id,
      enabled: false,
      metaJson: JSON.stringify(meta),
    } as never);
    markSkillArchived(name, root);
    return {
      success: true,
      name,
      archived: true,
      archivedTo: archived.archivedTo,
      message: `Skill「${name}」已归档（非硬删），可用文件恢复。`,
    };
  }

  return {
    error: `未知 action「${action}」。可用: create, patch, edit, write_file, remove_file, delete`,
  };
}

const SKILLS_DEFS: NativeToolDefinition[] = [
  {
    name: "skills_list",
    reentrant: true,
    description:
      "列出可用 Skill 元数据（渐进披露第 1 层）。只返回 name/短 description/kind，不含全文。需要正文时用 skill_view。",
    parameters: zodParams(
      z.object({
        keyword: z.string().describe("可选关键词过滤").optional(),
        includeDisabled: z.boolean().describe("是否包含未启用").optional(),
      }),
    ),
  },
  {
    name: "skill_view",
    reentrant: true,
    description:
      "加载 Skill 全文（渐进披露第 2 层）或包内附属文件（file_path=references/...）。procedural 技能应经此工具读取，而非 skill__*。",
    parameters: zodParams(
      z.object({
        name: z.string().describe("Skill 名称"),
        file_path: z
          .string()
          .describe("可选：references/x.md | templates/x | scripts/x")
          .optional(),
      }),
    ),
  },
  {
    name: "skill_manage",
    description:
      "管理程序记忆 Skill（Hermes 闭环）。Actions: create（完整 SKILL.md）、patch（old_string/new_string，优先）、edit（全文重写）、write_file/remove_file（附属文件）、delete（归档到 .archive，非硬删）。\n" +
      "Create when: 复杂任务成功（约 5+ tool calls）、攻克棘手错误、用户纠正后的可行流程、或用户要求记住程序。\n" +
      "Update when: 技能过时/缺步/坑未写——立刻 patch，不要等被要求。\n" +
      "Target: class-level 伞技能 + references/；禁止用 PR 号/今日任务名当 skill name。\n" +
      "description ≤60 字符。Memory 记「用户是谁」；Skill 记「这类任务怎么做」。",
    parameters: zodParams(
      z.object({
        action: z.enum(["create", "patch", "edit", "write_file", "remove_file", "delete"]),
        name: z.string().describe("小写连字符 skill 名"),
        content: z.string().describe("create/edit：完整 SKILL.md").optional(),
        old_string: z.string().optional(),
        new_string: z.string().optional(),
        replace_all: z.boolean().optional(),
        file_path: z.string().optional(),
        file_content: z.string().optional(),
      }),
    ),
  },
];

const SKILLS_HANDLERS: Record<string, NativeToolHandler> = {
  skills_list: skillsListTool,
  skill_view: skillViewTool,
  skill_manage: skillManageTool,
};

export function registerSkillsTools(): void {
  registerNativeDomain(SKILLS_DEFS, SKILLS_HANDLERS);
}

export { inferKindFromScanPath };
