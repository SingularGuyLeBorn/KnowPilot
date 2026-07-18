/**
 * Compact 前 Memory Flush — 学 OpenClaw：摘要前先提取关键事实写入长期记忆
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { chatCompletion } from "./llmClient.js";
import {
  isMemoryUserCreatable,
  MEMORY_FLUSH_STRENGTH_DEFAULT,
  MEMORY_FLUSH_STRENGTH_PREFERENCE,
  MEMORY_TYPES,
  type MemoryUserCreatableType,
} from "@knowpilot/shared";
import { createMemoryRepository, resolveMemoryWriteScope } from "./memoryRepository.js";
import { appendDailyNote } from "./memoryDaily.js";

const FLUSH_SYSTEM = `你是 KnowPilot 记忆提取助手。从对话 transcript 中提取应长期保存的信息。

规则：
- 只输出 JSON 数组，无 markdown 包裹
- 每项：{ "content": string, "type": "preference"|"semantic"|"episodic"|"note"|"procedural", "keywords": string[] }
- type 含义：preference=用户偏好；semantic=稳定事实/决策；episodic=某次具体经历；note=一般笔记；procedural=操作流程/套路
- 不要记：可从代码/git/文档直接查到的内容；临时 tool 输出；寒暄
- 不要重复已有摘要里的事实
- 若与已有长期记忆矛盾：仍可提取新事实（运行时可用 memory_update 软链纠正，勿重复堆叠同主题旧版）
- 最多 5 条；无值得保存的则输出 []`;

interface FlushFact {
  content: string;
  type: MemoryUserCreatableType;
  keywords: string[];
}

function parseFlushFacts(raw: string): FlushFact[] {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(arr)) return [];
    const out: FlushFact[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const content = String(rec.content ?? "").trim();
      const type = String(rec.type ?? MEMORY_TYPES.NOTE);
      if (!content || !isMemoryUserCreatable(type)) continue;
      const keywords = Array.isArray(rec.keywords)
        ? rec.keywords.map(String).filter(Boolean).slice(0, 8)
        : [];
      out.push({ content, type: type as MemoryUserCreatableType, keywords });
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function flushMemoriesBeforeCompact(
  config: AppConfig,
  services: ServiceContainer,
  transcript: string,
  model: string,
  options?: {
    existingSummary?: string | null;
    /** 写入 scope 的执行者；缺省（无 Agent）才落 global */
    actor?: { agentId?: string | null; workspaceId?: string | null; tier?: string | null };
  },
): Promise<number> {
  const flushCfg = config.compact?.memoryFlush;
  if (flushCfg?.enabled === false) return 0;
  const maxFacts = Math.max(1, Math.min(10, flushCfg?.maxFacts ?? 5));
  const slice = transcript.slice(0, 28_000);
  if (!slice.trim()) return 0;

  const existing = options?.existingSummary?.trim();
  const userContent = existing
    ? `[已有摘要]\n${existing}\n\n[待提取的新对话段]\n${slice}`
    : slice;

  // 有 Agent 时默认写 agent 层（manager 不能写 global）；无 Agent 的用户级路径才 global
  const writeScope = resolveMemoryWriteScope(undefined, {
    agentId: options?.actor?.agentId ?? undefined,
    workspaceId: options?.actor?.workspaceId ?? undefined,
    tier: options?.actor?.tier ?? undefined,
  });

  try {
    const resp = await chatCompletion({
      config,
      model,
      messages: [
        { role: "system", content: FLUSH_SYSTEM },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      maxTokens: 1024,
    });
    const facts = parseFlushFacts(resp.content ?? "").slice(0, maxFacts);
    const repo = createMemoryRepository(services);
    let written = 0;
    for (const fact of facts) {
      await repo.write({
        content: fact.content,
        type: fact.type,
        scope: writeScope,
        strength:
          fact.type === MEMORY_TYPES.PREFERENCE
            ? MEMORY_FLUSH_STRENGTH_PREFERENCE
            : MEMORY_FLUSH_STRENGTH_DEFAULT,
        keywords: fact.keywords,
        attribution: "flush",
      });
      written++;
    }
    // 日记层：记一条「今日压缩抢救了 N 条」工作笔记（不注入 prompt）
    if (written > 0) {
      try {
        appendDailyNote(config.projectRoot, `compact flush 写入 ${written} 条记忆 → ${writeScope}`, {
          source: "flush",
        });
      } catch {
        /* 日记失败不阻断 compact */
      }
      console.log(`[MemoryFlush] compact 前写入/刷新 ${written} 条长期记忆（scope=${writeScope}）`);
    }
    return written;
  } catch (err) {
    console.warn("[MemoryFlush] 提取失败，跳过:", err instanceof Error ? err.message : err);
    return 0;
  }
}
