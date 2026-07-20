import { describe, it, expect } from "vitest";
import {
  branchIndicatorLabel,
  collectBookmarks,
  countBranches,
  isBranchSummaryMessage,
  listBranchChildren,
} from "../chatTreeUi";

describe("chatTreeUi", () => {
  it("分支指示：≥2 个子节点才显示", () => {
    const children = { m1: ["c1", "c2"], m2: ["c3"] };
    expect(countBranches(children, "m1")).toBe(2);
    expect(branchIndicatorLabel(countBranches(children, "m1"))).toBe("2 个分支");
    expect(branchIndicatorLabel(countBranches(children, "m2"))).toBeNull();
  });

  it("分支指示：排除 branch_summary 子节点", () => {
    const children = { fork: ["a", "b", "sum"] };
    const kinds = { a: null, b: null, sum: "branch_summary" };
    expect(countBranches(children, "fork", kinds)).toBe(2);
  });

  it("书签收集与摘要卡判定", () => {
    const bookmarks = collectBookmarks([
      { id: "1", label: "重要", content: "hello world" },
      { id: "2", label: null, content: "skip" },
      { id: "3", label: "  ", content: "blank" },
    ]);
    expect(bookmarks).toEqual([{ id: "1", label: "重要", contentPreview: "hello world" }]);
    expect(isBranchSummaryMessage({ kind: "branch_summary", content: "x" })).toBe(true);
    expect(isBranchSummaryMessage({ content: "[kp-branch-summary]\n摘要" })).toBe(true);
    expect(isBranchSummaryMessage({ kind: null, content: "普通" })).toBe(false);
  });

  it("listBranchChildren 供切换菜单", () => {
    const nodes = [
      { id: "a", kind: null, contentPreview: "分支A", role: "assistant" },
      { id: "b", kind: null, contentPreview: "分支B", role: "assistant" },
      { id: "s", kind: "branch_summary", contentPreview: "摘要", role: "system" },
    ];
    const kids = listBranchChildren({ fork: ["a", "b", "s"] }, "fork", nodes);
    expect(kids.map((k) => k.id)).toEqual(["a", "b"]);
  });
});
