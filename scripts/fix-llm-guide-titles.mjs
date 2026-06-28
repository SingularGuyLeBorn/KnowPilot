import fs from "fs";
import path from "path";

const root = path.resolve("content/posts/llm-guide");

function parseFrontmatter(content) {
  const normalized = content.replace(/^\uFEFF/, "");
  const m = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const titleMatch = m[1].match(/^title:\s*(.+)$/m);
  if (!titleMatch) return null;
  let title = titleMatch[1].trim();
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }
  return { block: m[0], inner: m[1], title, hadBom: content.charCodeAt(0) === 0xfeff };
}

function extractPrefixFromName(name) {
  const m = name.match(/^(\d+(?:\.\d+)*)-/);
  return m ? m[1] : null;
}

function getExpectedPrefix(relPath) {
  const parts = relPath.split(/[/\\]/);
  const basename = parts[parts.length - 1].replace(/\.md$/, "");

  const filePrefix = extractPrefixFromName(basename);
  if (filePrefix) return filePrefix;

  const parent = parts[parts.length - 2];
  if (parent && parent === basename) {
    const fromSelf = extractPrefixFromName(parent);
    if (fromSelf) return fromSelf;
  }

  // 从最近的上级目录推断章节序号（如 5.3-国外大模型/xAI-Grok/xAI-Grok.md → 5.3）
  for (let i = parts.length - 2; i >= 0; i--) {
    const p = extractPrefixFromName(parts[i]);
    if (p) return p;
  }

  return null;
}

/** 去掉 title 开头所有形如 `13.1.2 · ` / `6.2 ` / `01 · ` 的序号段 */
function stripLeadingPrefixes(title) {
  let result = title.trim();
  const prefixRe = /^(\d+(?:\.\d+)*|\d{2})\s*(?:[·.]\s*|\s+)/u;
  while (prefixRe.test(result)) {
    result = result.replace(prefixRe, "").trim();
  }
  return result;
}

function titleHasPrefix(title, prefix) {
  const t = title.trim();
  const escaped = prefix.replace(/\./g, "\\.");
  const re = new RegExp(`^${escaped}(?:\\s|[·.\\-]|$)`);
  if (re.test(t)) return true;

  if (/^\d+$/.test(prefix)) {
    const n = parseInt(prefix, 10);
    const re2 = new RegExp(`^0?${n}(?:\\s|[·.\\-]|$)`);
    if (re2.test(t)) return true;
  }
  return false;
}

function formatTitle(prefix, coreTitle) {
  const trimmed = coreTitle.trim();
  if (!trimmed) return prefix;
  const sep = prefix.includes(".") || /^\d{2}$/.test(prefix) ? " · " : " ";
  return `${prefix}${sep}${trimmed}`;
}

function updateTitleInContent(content, fm, newTitle) {
  const quoted =
    newTitle.includes(":") || newTitle.includes('"')
      ? JSON.stringify(newTitle)
      : `"${newTitle}"`;
  const newInner = fm.inner.replace(/^title:\s*.+$/m, `title: ${quoted}`);
  const normalized = content.replace(/^\uFEFF/, "");
  const updated = normalized.replace(fm.block, fm.block.replace(fm.inner, newInner));
  return fm.hadBom ? `\uFEFF${updated}` : updated;
}

const fixed = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith(".md")) {
      const content = fs.readFileSync(p, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const rel = path.relative(root, p);
      const expected = getExpectedPrefix(rel);
      if (!expected) continue;

      const coreTitle = stripLeadingPrefixes(fm.title);
      const newTitle = formatTitle(expected, coreTitle);
      if (newTitle === fm.title) continue;

      const newContent = updateTitleInContent(content, fm, newTitle);
      fs.writeFileSync(p, newContent, "utf8");
      fixed.push({ rel, old: fm.title, new: newTitle });
    }
  }
}

walk(root);
console.log(`Fixed ${fixed.length} files`);
for (const f of fixed.slice(0, 25)) {
  console.log(`- ${f.rel}`);
  console.log(`  old: ${f.old}`);
  console.log(`  new: ${f.new}`);
}
if (fixed.length > 25) console.log(`... and ${fixed.length - 25} more`);
