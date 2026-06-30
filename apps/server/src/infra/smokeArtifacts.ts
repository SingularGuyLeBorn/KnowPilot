/** Vitest / E2E smoke 测试残留的命名模式（不应参与运行时信息源检索） */

const SMOKE_SOURCE_NAME = /^Smoke Source \d+$/;
const SMOKE_SOURCE_SLUG = /^smoke-source-\d+$/;
const SMOKE_AGENT_NAME = /^Smoke Agent \d+$/;
const SMOKE_POST_SLUG = /^smoke-post-\d+$/;
const SMOKE_PROMPT_SLUG = /^smoke-prompt-\d+$/;
const SMOKE_SKILL_SLUG = /^smoke_skill_[a-z0-9]+$/;
const SMOKE_MCP_SLUG = /^smoke_mcp_[a-z0-9]+$/;

export function isSmokeInfoSource(name: string, slug?: string | null): boolean {
  if (SMOKE_SOURCE_NAME.test(name.trim())) return true;
  if (slug && SMOKE_SOURCE_SLUG.test(slug)) return true;
  return false;
}

export function isSmokeContentSlug(slug: string): boolean {
  const s = slug.trim();
  return (
    SMOKE_SOURCE_SLUG.test(s) ||
    SMOKE_POST_SLUG.test(s) ||
    SMOKE_PROMPT_SLUG.test(s) ||
    SMOKE_SKILL_SLUG.test(s) ||
    SMOKE_MCP_SLUG.test(s)
  );
}

export function isSmokeAgentName(name: string): boolean {
  return SMOKE_AGENT_NAME.test(name.trim());
}

export const SMOKE_CONTENT_GLOBS = [
  "smoke-source-*.json",
  "smoke-post-*.md",
  "smoke-prompt-*.md",
  "smoke_skill_*.md",
  "smoke_mcp_*.json",
  "Smoke Agent *.md",
  "vitest-test-file-*",
] as const;
