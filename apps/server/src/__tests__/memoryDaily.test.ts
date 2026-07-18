import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { appendDailyNote, searchDailyNotes } from "../infra/memoryDaily.js";

describe("memoryDaily L2 日记层", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kp-daily-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("append 写入 daily/YYYY-MM-DD.md", () => {
    const r = appendDailyNote(root, "今天完成了 OCR 接线", { day: "2026-07-18", source: "test" });
    expect(r.day).toBe("2026-07-18");
    expect(r.path).toBe("content/memories/daily/2026-07-18.md");
    const body = fs.readFileSync(path.join(root, r.path), "utf8");
    expect(body).toContain("今天完成了 OCR 接线");
    expect(body).toContain("# 2026-07-18");
  });

  it("search 按关键词命中且不依赖 Memory 表", () => {
    appendDailyNote(root, "调研 Mem0 与 FTS", { day: "2026-07-17" });
    appendDailyNote(root, "实现日记层 search", { day: "2026-07-18" });
    const hit = searchDailyNotes(root, "日记");
    expect(hit.total).toBeGreaterThanOrEqual(1);
    expect(hit.items.some((i) => i.line.includes("日记层"))).toBe(true);
    const miss = searchDailyNotes(root, "向量库不存在的词xyz");
    expect(miss.total).toBe(0);
  });
});
