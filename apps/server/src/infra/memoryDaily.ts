/**
 * L2 工作日记层 — content/memories/daily/YYYY-MM-DD.md
 * 只 search / append，不注入 system prompt（与 L1 pinned / L3 Memory 表正交）。
 */

import fs from "fs";
import path from "path";

const DAILY_DIR_REL = path.join("content", "memories", "daily");

function dailyDir(projectRoot: string): string {
  return path.join(projectRoot, DAILY_DIR_REL);
}

function dayFile(projectRoot: string, day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`日期格式无效：${day}（期望 YYYY-MM-DD）`);
  }
  return path.join(dailyDir(projectRoot), `${day}.md`);
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureDailyDir(projectRoot: string): void {
  const dir = dailyDir(projectRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 追加一行工作笔记到指定日（默认今天） */
export function appendDailyNote(
  projectRoot: string,
  content: string,
  options?: { day?: string; source?: string },
): { day: string; path: string; bytes: number } {
  const text = content.trim();
  if (!text) throw new Error("日记内容不能为空");
  const day = options?.day ?? todayLocal();
  ensureDailyDir(projectRoot);
  const filePath = dayFile(projectRoot, day);
  const ts = new Date().toISOString().slice(11, 19);
  const source = options?.source ? ` (${options.source})` : "";
  const line = `- ${ts}${source} ${text.replace(/\s+/g, " ").slice(0, 2000)}\n`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# ${day}\n\n${line}`, "utf8");
  } else {
    fs.appendFileSync(filePath, line, "utf8");
  }
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  return { day, path: rel, bytes: Buffer.byteLength(line, "utf8") };
}

export type DailyHit = { day: string; path: string; line: string; lineNo: number };

/** 在日记文件中按关键词检索（大小写不敏感；只扫最近 maxDays 天） */
export function searchDailyNotes(
  projectRoot: string,
  keyword: string,
  options?: { maxDays?: number; maxHits?: number },
): { total: number; items: DailyHit[] } {
  const q = keyword.trim().toLowerCase();
  const maxDays = Math.max(1, Math.min(90, options?.maxDays ?? 30));
  const maxHits = Math.max(1, Math.min(50, options?.maxHits ?? 20));
  const dir = dailyDir(projectRoot);
  if (!fs.existsSync(dir)) return { total: 0, items: [] };

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, maxDays);

  const items: DailyHit[] = [];
  for (const file of files) {
    const day = file.slice(0, 10);
    const abs = path.join(dir, file);
    const body = fs.readFileSync(abs, "utf8");
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("- ")) continue;
      if (q && !line.toLowerCase().includes(q)) continue;
      items.push({
        day,
        path: path.relative(projectRoot, abs).replace(/\\/g, "/"),
        line: line.slice(0, 300),
        lineNo: i + 1,
      });
      if (items.length >= maxHits) {
        return { total: items.length, items };
      }
    }
  }
  return { total: items.length, items };
}
