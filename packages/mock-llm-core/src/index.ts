/**
 * @knowpilot/mock-llm-core — LLM 协议类型 + Mock 场景逻辑（单源）
 *
 * 消费者：
 * - apps/server：llmClient.ts 取类型 + MOCK_LLM 分支调 mockChatCompletion/Stream
 * - apps/mock-llm：HTTP 包装，复用场景逻辑 + 错误注入
 */

export type {
  LlmContentPart,
  LlmMessage,
  LlmToolDefinition,
  LlmToolCall,
  LlmCompletionResult,
  LlmRequestOptions,
  StreamChunk,
} from "./types.js";

export {
  type MockLlmOptions,
  type MockLlmScenario,
  lastUserText,
  hasTool,
  firstToolName,
  hasAnyToolResult,
  mockLog,
  makeToolCall,
  baseResult,
  delayYield,
  streamFromCompletion,
} from "./scenarios.js";

export {
  scenarios,
  resolveScenario,
  mockChatCompletion,
  mockChatCompletionStream,
  registerMockLlmScenario,
} from "./scenarioDefs.js";
