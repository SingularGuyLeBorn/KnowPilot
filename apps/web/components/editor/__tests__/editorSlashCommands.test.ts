import { describe, expect, it } from "vitest";
import {
  applySlashInSource,
  filterSlashCommands,
  matchSlashToken,
  resolveExactSlashCommand,
} from "@/components/editor/editorSlashCommands";

describe("editorSlashCommands", () => {
  it("matchSlashToken 识别 /gs", () => {
    expect(matchSlashToken("/gs")).toEqual({ token: "/gs", query: "gs" });
    expect(matchSlashToken("hello /hb")).toEqual({ token: "/hb", query: "hb" });
    expect(matchSlashToken("nogslash")).toBeNull();
  });

  it("resolveExactSlashCommand 飞书别名", () => {
    expect(resolveExactSlashCommand("gs")?.id).toBe("math");
    expect(resolveExactSlashCommand("eq")?.id).toBe("math");
    expect(resolveExactSlashCommand("code")?.id).toBe("code");
    expect(resolveExactSlashCommand("dm")?.id).toBe("code");
    expect(resolveExactSlashCommand("hb")?.id).toBe("board");
    expect(resolveExactSlashCommand("tb")?.id).toBe("table");
    expect(resolveExactSlashCommand("xyz")).toBeNull();
  });

  it("filterSlashCommands 前缀过滤", () => {
    expect(filterSlashCommands("g").map((c) => c.id)).toEqual(["math"]);
    expect(filterSlashCommands("co").map((c) => c.id)).toEqual(["code"]);
    expect(filterSlashCommands("tb").map((c) => c.id)).toEqual(["table"]);
    expect(filterSlashCommands("hb").map((c) => c.id)).toEqual(["board"]);
    expect(filterSlashCommands("").length).toBeGreaterThanOrEqual(4);
  });

  it("applySlashInSource /gs 插入空公式块", () => {
    const r = applySlashInSource("/gs", 3, resolveExactSlashCommand("gs")!);
    expect(r).not.toBeNull();
    expect(r!.next).toContain("$$\n\n$$\n");
  });

  it("applySlashInSource /code 插入空代码块", () => {
    const r = applySlashInSource("/code", 5, resolveExactSlashCommand("code")!);
    expect(r).not.toBeNull();
    expect(r!.next).toContain("```\n\n```\n");
    expect(r!.cursor).toBe(4); // 落在代码体内
  });

  it("applySlashInSource /hb 插入画板 fence", () => {
    const r = applySlashInSource("/hb", 3, resolveExactSlashCommand("hb")!);
    expect(r).not.toBeNull();
    expect(r!.next).toContain("```kp-board");
    expect(r!.next).toContain('"strokes":[]');
  });

  it("applySlashInSource /tb 插入表格", () => {
    const r = applySlashInSource("/tb", 3, resolveExactSlashCommand("tb")!);
    expect(r).not.toBeNull();
    expect(r!.next).toContain("| 列1 | 列2 | 列3 |");
  });
});

