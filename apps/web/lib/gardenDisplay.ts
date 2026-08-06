/**
 * 花园 id / 标题展示：不缩写；连字符分段；专有缩写大小写正确。
 * RSI = Recursive Self-Improvement（递归自我改进）
 */

const GARDEN_ID_LABEL: Record<string, string> = {
  cs336: "CS336",
  /** 全称见花园标题：Recursive Self-Improvement · 递归自我改进 */
  rsi: "RSI",
  longhorizon: "Long-Horizon",
  multiagent: "Multi-Agent",
  "daily-fragments": "Daily-Fragments",
  "llm-guide": "LLM-Guide",
  "llm-interview": "LLM-Interview",
  "diffusion-llm": "Diffusion-LLM",
  posts: "Posts",
  knowledge: "Knowledge",
  resources: "Resources",
  essays: "Essays",
};

const ACRONYM_SEGS = new Set(["llm", "rsi", "ai", "api", "ui", "db", "rag", "mcp"]);

export function formatGardenId(id: string): string {
  if (GARDEN_ID_LABEL[id]) return GARDEN_ID_LABEL[id];
  return id
    .split("-")
    .map((seg) => {
      const lower = seg.toLowerCase();
      if (ACRONYM_SEGS.has(lower)) return lower.toUpperCase();
      if (/^[a-z]+\d+[a-z0-9]*$/i.test(seg)) return seg.toUpperCase();
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    })
    .join("-");
}

export function displayGardenTitle(title: string): string {
  return title.trim();
}
