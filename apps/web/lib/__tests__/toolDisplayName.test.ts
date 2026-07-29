import { describe, expect, it } from "vitest";
import { formatToolDisplayName, toPascalCaseId } from "@/lib/toolDisplayName";

describe("formatToolDisplayName", () => {
  it("snake_case → PascalCase", () => {
    expect(formatToolDisplayName("write_file")).toBe("WriteFile");
    expect(formatToolDisplayName("algo_viz_create")).toBe("AlgoVizCreate");
    expect(formatToolDisplayName("async_task_run")).toBe("AsyncTaskRun");
  });

  it("剥离 native: 前缀", () => {
    expect(formatToolDisplayName("native:write_file")).toBe("WriteFile");
  });

  it("skill / mcp 前缀", () => {
    expect(formatToolDisplayName("skill__foo_bar")).toBe("SkillFooBar");
    expect(formatToolDisplayName("mcp__server__tool_name")).toBe("McpServerToolName");
  });

  it("伪步骤", () => {
    expect(formatToolDisplayName("__thinking__")).toBe("Thinking");
    expect(formatToolDisplayName("session_compact")).toBe("SessionCompact");
  });
});

describe("toPascalCaseId", () => {
  it("分段大写", () => {
    expect(toPascalCaseId("write_file")).toBe("WriteFile");
    expect(toPascalCaseId("a.b-c")).toBe("ABC");
  });
});
