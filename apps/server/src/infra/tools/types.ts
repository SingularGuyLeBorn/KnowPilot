/**
 * ToolCommand — 统一工具命令契约（开闭原则）
 *
 * 新增 native 工具 = 实现本接口 + registerTool()，禁止再改 executeNativeTool 核心分支。
 * rollback 可选：D 类写入工具后续可补补偿入口。
 */

export type ToolKind = "native" | "skill" | "mcp";
export type ToolConcurrencyClass = "A" | "B" | "C" | "D";

export interface ToolSchema {
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Ctx 由注册方决定（native 用 NativeToolContext；skill/mcp 可另定）。
 * registry 本身不依赖 nativeTools，避免循环引用。
 */
export interface ToolCommand<Ctx = unknown> {
  name: string;
  kind: ToolKind;
  concurrencyClass?: ToolConcurrencyClass;
  schema(): ToolSchema;
  execute(params: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
  /** 补偿入口，必须幂等；未实现则跳过 */
  rollback?(params: Record<string, unknown>, executedResult: unknown, ctx: Ctx): Promise<void>;
}
