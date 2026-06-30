/**
 * Agent 工具授权 — 前后端共享的解析 / 序列化 / 物化逻辑
 *
 * UI 与运行时会对空 native 或仅有 skill/mcp 的配置注入默认内置工具；
 * 保存时应调用 materializeAgentTools，使 Markdown 与界面展示一致。
 */

/** 未显式勾选 native 时自动附带的基础内置工具（与后端 parseAgentTools 一致） */
export const DEFAULT_AGENT_NATIVE = [
  "web_search",
  "read_file",
  "list_directory",
  "invoke_api",
] as const;

export type DefaultAgentNative = (typeof DEFAULT_AGENT_NATIVE)[number];

export interface AgentToolSelection {
  native: string[];
  skillWildcard: boolean;
  skills: string[];
  mcp: string[];
}

/** 解析 tools 配置为结构化选择（含 UI/运行时隐式默认） */
export function parseAgentToolSelection(tools: string[]): AgentToolSelection {
  const native = tools.filter((t) => t.startsWith("native:")).map((t) => t.slice(7));
  const skillWildcard = tools.includes("skill:*");
  const skills = tools
    .filter((t) => t.startsWith("skill:") && t !== "skill:*")
    .map((t) => t.slice(6));
  const mcp = tools.filter((t) => t.startsWith("mcp:")).map((t) => t.slice(4));

  const nativeSet = new Set(native);

  if (tools.length === 0) {
    for (const name of DEFAULT_AGENT_NATIVE) nativeSet.add(name);
    return { native: [...nativeSet], skillWildcard: true, skills, mcp };
  }

  const hasNonNative = skillWildcard || skills.length > 0 || mcp.length > 0;
  if (nativeSet.size === 0 && hasNonNative) {
    for (const name of DEFAULT_AGENT_NATIVE) nativeSet.add(name);
  }

  return {
    native: [...nativeSet],
    skillWildcard,
    skills,
    mcp,
  };
}

function orderNativeNames(names: string[]): string[] {
  const set = new Set(names);
  const ordered: string[] = [];
  for (const name of DEFAULT_AGENT_NATIVE) {
    if (set.has(name)) ordered.push(name);
  }
  for (const name of [...set].sort()) {
    if (!DEFAULT_AGENT_NATIVE.includes(name as DefaultAgentNative)) ordered.push(name);
  }
  return ordered;
}

/** 将结构化选择序列化为 tools 配置行 */
export function serializeAgentTools(sel: AgentToolSelection): string[] {
  const lines: string[] = [];
  for (const name of orderNativeNames(sel.native)) {
    lines.push(`native:${name}`);
  }
  if (sel.skillWildcard) lines.push("skill:*");
  else {
    for (const name of [...sel.skills].sort()) lines.push(`skill:${name}`);
  }
  for (const name of [...sel.mcp].sort()) lines.push(`mcp:${name}`);
  return lines;
}

/**
 * 物化隐式默认：返回与 UI 实际生效列表一致的 tools 配置。
 * 保存 Agent 或写入 Markdown 前应调用。
 */
export function materializeAgentTools(tools: string[]): string[] {
  return serializeAgentTools(parseAgentToolSelection(tools));
}
