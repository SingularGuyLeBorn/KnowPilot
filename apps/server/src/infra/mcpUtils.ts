/**
 * MCP 纯函数叶子模块 —— 打断 mcpClient ↔ mockMcpRegistry 运行时循环依赖
 *
 * 只放无副作用的纯函数；双方（以及需要安全外部名的其他模块）一律从此导入，
 * 禁止再回引 mcpClient。
 */

/** 单个 MCP 结果进上下文的最大字符数 */
export const MCP_MAX_RESULT_CHARS = 12_000;

/** 生成 MCP 工具的安全外部名：mcp__{server}__{tool} */
export function mcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${safeServer}__${safeTool}`;
}

/** 截断过大 MCP 结果，避免撑爆上下文 */
export function truncateMcpResult(result: unknown): unknown {
  const json = JSON.stringify(result);
  if (json.length <= MCP_MAX_RESULT_CHARS) return result;

  const truncated = json.slice(0, MCP_MAX_RESULT_CHARS);
  let parsed: unknown = truncated;
  try {
    parsed = JSON.parse(truncated);
  } catch {
    parsed = truncated;
  }

  return {
    _truncated: true,
    _originalChars: json.length,
    _maxChars: MCP_MAX_RESULT_CHARS,
    preview: parsed,
    hint: "MCP 结果过大已截断。请缩小查询范围或分页获取。",
  };
}
