/**
 * LLM Transport 适配 — sync / stream 共用同一 complete() 契约
 */

import type { AppConfig } from "../config.js";
import {
  chatCompletion,
  chatCompletionStream,
  type LlmMessage,
  type LlmToolDefinition,
} from "../llmClient.js";
import type { LlmTransport, LlmTurnResult, LoopHooks, StreamLlmOptions } from "./types.js";

export function createSyncTransport(config: AppConfig, model: string): LlmTransport {
  return {
    async complete({ messages, tools, signal, withTools }): Promise<LlmTurnResult> {
      const completion = await chatCompletion({
        config,
        model,
        messages,
        tools: withTools ? tools : undefined,
        signal,
      });
      return {
        content: completion.content,
        reasoningContent: completion.reasoningContent,
        toolCalls: completion.toolCalls,
        tokenUsage: completion.tokenUsage,
        model: completion.model,
        provider: completion.provider,
      };
    },
  };
}

export function createStreamTransport(
  config: AppConfig,
  model: string,
  llmOptions: StreamLlmOptions,
  hooks?: LoopHooks,
  /** 当前轮次号，供 onThinking 使用；由 reactLoop 在每轮开始前写入 */
  getRound?: () => number,
): LlmTransport {
  return {
    async complete({ messages, tools, signal, withTools }): Promise<LlmTurnResult> {
      let content = "";
      let reasoning = "";
      let toolCalls: LlmTurnResult["toolCalls"] = [];
      let tokenUsage: LlmTurnResult["tokenUsage"];
      let lastModel = model;
      let lastProvider = config.llm.defaultProvider;
      const round = getRound?.() ?? 0;

      for await (const chunk of chatCompletionStream({
        config,
        model,
        messages,
        tools: withTools ? tools : undefined,
        temperature: llmOptions.temperature,
        maxTokens: llmOptions.maxTokens,
        enableReasoning: llmOptions.enableReasoning,
        reasoningEffort: llmOptions.reasoningEffort,
        signal,
      })) {
        if (chunk.model) lastModel = chunk.model;
        if (chunk.provider) lastProvider = chunk.provider;
        if (chunk.tokenUsage) tokenUsage = chunk.tokenUsage;

        if (chunk.type === "reasoning" && chunk.delta) {
          reasoning += chunk.delta;
          hooks?.onThinking?.(round, chunk.delta);
        }
        if (chunk.type === "token" && chunk.delta) {
          content += chunk.delta;
          hooks?.onToken?.(chunk.delta);
        }
        if (chunk.type === "tool_calls" && chunk.toolCalls?.length) {
          toolCalls = chunk.toolCalls;
        }
      }

      return {
        content: content || null,
        reasoningContent: reasoning || null,
        toolCalls,
        tokenUsage,
        model: lastModel,
        provider: lastProvider,
      };
    },
  };
}

/** 类型再导出，供测试使用 */
export type { LlmMessage, LlmToolDefinition };
