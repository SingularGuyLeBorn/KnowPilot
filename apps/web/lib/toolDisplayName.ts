/**
 * 前端工具名展示：底层仍为 snake_case（write_file），UI 统一大驼峰（WriteFile）。
 */

const PSEUDO_DISPLAY: Record<string, string> = {
  __thinking__: "Thinking",
  __content__: "Content",
  __reflection__: "Reflection",
  __context_compact__: "ContextCompact",
  session_compact: "SessionCompact",
};

/** snake_case / kebab / dotted → PascalCase；保留已有词内大小写段 */
export function toPascalCaseId(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * 聊天时间线 / 工具勾选 / 审批列表等统一展示名。
 * - write_file → WriteFile
 * - native:write_file → WriteFile
 * - skill__foo_bar → SkillFooBar
 * - mcp__server__tool_name → McpServerToolName
 */
export function formatToolDisplayName(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  if (PSEUDO_DISPLAY[raw]) return PSEUDO_DISPLAY[raw];

  let rest = raw;
  let prefix = "";

  if (rest.startsWith("native:")) {
    rest = rest.slice("native:".length);
  } else if (rest.startsWith("skill:")) {
    prefix = "Skill";
    rest = rest.slice("skill:".length);
  } else if (rest.startsWith("mcp:")) {
    prefix = "Mcp";
    rest = rest.slice("mcp:".length);
  } else if (rest.startsWith("skill__")) {
    prefix = "Skill";
    rest = rest.slice("skill__".length);
  } else if (rest.startsWith("mcp__")) {
    prefix = "Mcp";
    rest = rest.slice("mcp__".length);
  }

  if (PSEUDO_DISPLAY[rest]) return PSEUDO_DISPLAY[rest];

  const pascal = toPascalCaseId(rest);
  return prefix ? `${prefix}${pascal}` : pascal;
}
