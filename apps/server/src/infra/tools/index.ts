/**
 * tools 公共出口
 */

export type { ToolCommand, ToolKind, ToolConcurrencyClass, ToolSchema } from "./types.js";
export {
  registerTool,
  getTool,
  hasTool,
  listTools,
  listToolNames,
  __resetToolRegistryForTests,
} from "./registry.js";
export type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./native/types.js";
export { coerceToolBoolean, registerNativeDomains } from "./native/index.js";
