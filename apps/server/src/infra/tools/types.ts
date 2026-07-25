/**
 * ToolCommand — 统一工具命令契约（开闭原则）
 *
 * 新增 native 工具 = 实现本接口 + registerTool()，禁止再改 executeNativeTool 核心分支。
 * D 类（destructive）工具经 captureRollback/rollback 提供幂等补偿（见 ./rollback.ts）。
 */

export type ToolKind = "native" | "skill" | "mcp";
export type ToolConcurrencyClass = "A" | "B" | "C" | "D";

export interface ToolSchema {
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * D 类工具的补偿实现（域文件经 registerNativeDomain 第三参数挂入）：
 * - capture：执行前快照（如 write_file 旧内容），返回值原样透传给 compensate；
 * - compensate：run 失败时的补偿动作，必须幂等；返回字符串作为回滚报告中的说明。
 */
export interface ToolRollback<Ctx = unknown> {
  capture?(params: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
  compensate(
    params: Record<string, unknown>,
    executedResult: unknown,
    captured: unknown,
    ctx: Ctx,
  ): Promise<void | string>;
}

/**
 * Ctx 由注册方决定（native 用 NativeToolContext；skill/mcp 可另定）。
 * registry 本身不依赖 nativeTools，避免循环引用。
 */
export interface ToolCommand<Ctx = unknown> {
  name: string;
  kind: ToolKind;
  concurrencyClass?: ToolConcurrencyClass;
  /**
   * D 类（写入/副作用）标记：本 run 执行后进入回滚栈，run 失败（非用户 abort）时逆序补偿。
   * 审批清单唯一事实源：registry 上 destructive && !approvalExempt（见 listDestructiveNativeOpsForApproval）。
   */
  destructive?: boolean;
  /**
   * 审批豁免：destructive 工具默认入 AGENT_DESTRUCTIVE_APPROVAL 清单；
   * 确需豁免（如可回滚的常规写入）须显式声明并附理由注释。
   */
  approvalExempt?: boolean;
  /**
   * P1-03：默认对 LLM 隐藏（不进 schema）除非 Agent 显式声明该工具。
   * 用于危险工具（run_shell / git_push / file_delete / github_delete_repo 等）的渐进披露——
   * native:"all" 时跳过 defaultHidden=true 的工具，Agent 想用必须显式 `native:<name>`。
   * registerNativeDomain 对 destructive && !approvalExempt 自动设 defaultHidden=true（除非显式覆盖）。
   */
  defaultHidden?: boolean;
  /**
   * W3：可选 scope 派生（缺省走 approvalScope 内置表）。
   * 返回值须为 `<domain>:<verb>:<target>`；LLM 不可见。
   */
  deriveScope?(args: Record<string, unknown>): string | null | undefined;
  schema(): ToolSchema;
  execute(params: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
  /** 执行前快照（destructive 工具按需实现）；返回值原样透传给 rollback */
  captureRollback?(params: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
  /**
   * 补偿入口，必须幂等；captured 为 captureRollback 的返回（未实现 capture 则为 undefined）。
   * 返回字符串作为回滚说明；未实现则 run 失败时只记 warn（不可逆操作如实声明，不假装能回滚）。
   */
  rollback?(params: Record<string, unknown>, executedResult: unknown, captured: unknown, ctx: Ctx): Promise<void | string>;
}
