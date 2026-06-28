/**
 * Markdown 预处理 LRU 缓存 — L5-M06
 */

const MAX_ENTRIES = 64;

interface CacheEntry {
  source: string;
  output: string;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(content: string): string {
  if (content.length <= 128) return content;
  return `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`;
}

export function memoizeMarkdownTransform(
  content: string,
  transform: (input: string) => string,
): string {
  const key = cacheKey(content);
  const hit = cache.get(key);
  if (hit && hit.source === content) return hit.output;

  const output = transform(content);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { source: content, output });
  return output;
}

export function clearMarkdownCache(): void {
  cache.clear();
}
