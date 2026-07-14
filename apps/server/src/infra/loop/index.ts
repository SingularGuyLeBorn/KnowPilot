/**
 * Agent Loop 公共出口
 */

export { createPhaseMachine, type AgentRunPhase, type PhaseMachine } from "./phase.js";
export type {
  TurnSnapshot,
  LlmTurnResult,
  LlmTransport,
  LoopHooks,
  ReactLoopInput,
  ReactLoopResult,
  ReflectionVerdict,
  StreamLlmOptions,
} from "./types.js";
export { runReactLoop } from "./reactLoop.js";
export { createSyncTransport, createStreamTransport } from "./transports.js";
export { withReflection, REFLECTION_UNPASSED_MARK, type ReflectionOptions } from "./reflection.js";
export {
  DEFAULT_SUBAGENT_TOOLS,
  resolveToolsForAgentTier,
  parseToolCall,
} from "./setup.js";
