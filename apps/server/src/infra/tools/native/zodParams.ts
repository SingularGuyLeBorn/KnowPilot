/**
 * Zod → JSON Schema 转换（与 router.ts ai.tools 同一转换器 zodToJsonSchema）。
 * native 工具的 parameters 统一经此生成，避免手写 JSON 字面量与 Zod 真相漂移。
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/** 生成 LLM function calling 的 parameters（剥掉 $schema 元字段） */
export function zodParams(schema: z.ZodType): Record<string, unknown> {
  const json = zodToJsonSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
