/**
 * Procedural Skill 包路径与 kind 约定（Hermes SKILL.md 目录形态）
 *
 * - procedural: content/skills/{name}/SKILL.md + references|templates|scripts
 * - executable: content/skills/{slug}.md（沙箱 run / prompt）
 * - reference: 参考资料，默认不启用、不进工具 schema
 */

import fs from "fs";
import path from "path";

export type SkillKind = "procedural" | "executable" | "reference";

const SUPPORT_DIRS = new Set(["references", "templates", "scripts", "assets"]);

export function sanitizeSkillName(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function parseSkillKind(metaJson?: string | null, fallback: SkillKind = "executable"): SkillKind {
  if (!metaJson) return fallback;
  try {
    const meta = JSON.parse(metaJson) as { kind?: string };
    if (meta.kind === "procedural" || meta.kind === "executable" || meta.kind === "reference") {
      return meta.kind;
    }
    // 旧值 skill → executable（无兼容分支永久保留：读路径归一即可）
    if (meta.kind === "skill") return "executable";
  } catch {
    /* ignore */
  }
  return fallback;
}

/** FileSync / sourceSlug：procedural → `{name}/SKILL`；其余 → `{name}` */
export function skillFileSlug(name: string, kind: SkillKind): string {
  const safe = sanitizeSkillName(name) || "unnamed-skill";
  return kind === "procedural" ? `${safe}/SKILL` : safe;
}

export function skillPackageDir(skillsRoot: string, name: string): string {
  return path.join(skillsRoot, sanitizeSkillName(name) || "unnamed-skill");
}

export function skillMdPath(skillsRoot: string, name: string, kind: SkillKind): string {
  const slug = skillFileSlug(name, kind);
  return path.join(skillsRoot, `${slug}.md`);
}

export function isSkillSupportRelPath(relPosix: string): boolean {
  const parts = relPosix.replace(/\\/g, "/").split("/");
  if (parts.length < 2) return false;
  return SUPPORT_DIRS.has(parts[1]!);
}

export function shouldSkipSkillScanPath(relPosix: string): boolean {
  const rel = relPosix.replace(/\\/g, "/");
  if (rel.startsWith(".archive/") || rel.includes("/.archive/")) return true;
  if (rel === ".usage.json" || rel.endsWith("/.usage.json")) return true;
  if (rel.endsWith("/.curator_state") || rel === ".curator_state") return true;
  const base = path.posix.basename(rel);
  if (base === "SKILL.md") return false;
  // 包内附属 md 不单独建 Skill 行
  if (isSkillSupportRelPath(rel)) return true;
  return false;
}

export function inferKindFromScanPath(relPosix: string, fmKind?: string): SkillKind {
  const rel = relPosix.replace(/\\/g, "/");
  if (fmKind === "procedural" || fmKind === "executable" || fmKind === "reference") {
    return fmKind;
  }
  if (fmKind === "skill") return "executable";
  if (path.posix.basename(rel) === "SKILL.md") return "procedural";
  if (rel.startsWith("design-references/")) return "reference";
  return "executable";
}

export function listSkillLinkedFiles(skillsRoot: string, name: string): Record<string, string[]> {
  const root = skillPackageDir(skillsRoot, name);
  const out: Record<string, string[]> = { references: [], templates: [], scripts: [], assets: [] };
  for (const dir of SUPPORT_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const files = fs
      .readdirSync(abs)
      .filter((f) => fs.statSync(path.join(abs, f)).isFile())
      .map((f) => `${dir}/${f}`);
    out[dir] = files;
  }
  return out;
}

export function readSkillSupportFile(
  skillsRoot: string,
  name: string,
  filePath: string,
): { ok: true; content: string; absPath: string } | { ok: false; error: string } {
  const safeName = sanitizeSkillName(name);
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    return { ok: false, error: "非法 file_path" };
  }
  const top = normalized.split("/")[0];
  if (!SUPPORT_DIRS.has(top || "")) {
    return { ok: false, error: "file_path 须以 references/、templates/、scripts/ 或 assets/ 开头" };
  }
  const abs = path.resolve(skillPackageDir(skillsRoot, safeName), normalized);
  const root = path.resolve(skillPackageDir(skillsRoot, safeName));
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return { ok: false, error: "路径越界" };
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, error: `文件不存在: ${normalized}` };
  }
  return { ok: true, content: fs.readFileSync(abs, "utf-8"), absPath: abs };
}

export function writeSkillSupportFile(
  skillsRoot: string,
  name: string,
  filePath: string,
  content: string,
): { ok: true; absPath: string } | { ok: false; error: string } {
  const safeName = sanitizeSkillName(name);
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    return { ok: false, error: "非法 file_path" };
  }
  const top = normalized.split("/")[0];
  if (!SUPPORT_DIRS.has(top || "")) {
    return { ok: false, error: "file_path 须以 references/、templates/、scripts/ 或 assets/ 开头" };
  }
  const abs = path.resolve(skillPackageDir(skillsRoot, safeName), normalized);
  const root = path.resolve(skillPackageDir(skillsRoot, safeName));
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return { ok: false, error: "路径越界" };
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return { ok: true, absPath: abs };
}

export function archiveSkillPackage(
  skillsRoot: string,
  name: string,
  kind: SkillKind,
): { ok: true; archivedTo: string } | { ok: false; error: string } {
  const archiveRoot = path.join(skillsRoot, ".archive");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = sanitizeSkillName(name) || "unnamed-skill";
  if (kind === "procedural") {
    const src = skillPackageDir(skillsRoot, safe);
    if (!fs.existsSync(src)) return { ok: false, error: `Skill 包不存在: ${safe}` };
    const dest = path.join(archiveRoot, `${safe}-${stamp}`);
    fs.renameSync(src, dest);
    return { ok: true, archivedTo: dest };
  }
  const srcFile = skillMdPath(skillsRoot, safe, "executable");
  if (!fs.existsSync(srcFile)) return { ok: false, error: `Skill 文件不存在: ${safe}` };
  const dest = path.join(archiveRoot, `${safe}-${stamp}.md`);
  fs.renameSync(srcFile, dest);
  return { ok: true, archivedTo: dest };
}

/** Hermes HARDLINE 精简：create 时若正文过短可提示，不强制改写 */
export function truncateSkillDescription(desc: string, max = 60): string {
  const t = desc.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + ".";
}
