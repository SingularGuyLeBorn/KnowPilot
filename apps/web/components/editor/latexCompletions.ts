/**
 * 公式编辑 Copilot 式补全：本地 LaTeX 片段（零 API、低延迟）。
 * Tab 接受幽灵后缀；Esc 先消补全再退出编辑。
 */

export type LatexCompletion = {
  /** 光标前要被替换的片段（含可选 \） */
  trigger: string;
  /** 替换为的完整文本 */
  insert: string;
  /** 插入后光标相对 insert 末尾回退格数（落在首个空组内） */
  cursorBack: number;
  label: string;
};

type Snippet = {
  keys: string[];
  /** 用 $1 $2… 标光标/空位，展开时去掉 */
  body: string;
  label: string;
};

const SNIPPETS: Snippet[] = [
  { keys: ["frac", "分数"], body: "\\frac{$1}{$2}", label: "分数" },
  { keys: ["dfrac"], body: "\\dfrac{$1}{$2}", label: "大分数" },
  { keys: ["sqrt", "根号"], body: "\\sqrt{$1}", label: "根号" },
  { keys: ["sum", "求和"], body: "\\sum_{$1}^{$2}", label: "求和" },
  { keys: ["prod", "求积"], body: "\\prod_{$1}^{$2}", label: "求积" },
  { keys: ["int", "积分"], body: "\\int_{$1}^{$2}", label: "积分" },
  { keys: ["lim", "极限"], body: "\\lim_{$1}", label: "极限" },
  { keys: ["infty", "inf", "无穷"], body: "\\infty", label: "无穷" },
  { keys: ["partial", "偏导"], body: "\\partial", label: "偏导" },
  { keys: ["nabla"], body: "\\nabla", label: "梯度" },
  { keys: ["alpha"], body: "\\alpha", label: "α" },
  { keys: ["beta"], body: "\\beta", label: "β" },
  { keys: ["gamma"], body: "\\gamma", label: "γ" },
  { keys: ["delta"], body: "\\delta", label: "δ" },
  { keys: ["epsilon", "eps"], body: "\\epsilon", label: "ε" },
  { keys: ["theta"], body: "\\theta", label: "θ" },
  { keys: ["lambda"], body: "\\lambda", label: "λ" },
  { keys: ["mu"], body: "\\mu", label: "μ" },
  { keys: ["pi"], body: "\\pi", label: "π" },
  { keys: ["sigma"], body: "\\sigma", label: "σ" },
  { keys: ["omega"], body: "\\omega", label: "ω" },
  { keys: ["cdot", "点乘"], body: "\\cdot", label: "点乘" },
  { keys: ["times"], body: "\\times", label: "×" },
  { keys: ["pm"], body: "\\pm", label: "±" },
  { keys: ["leq", "le"], body: "\\leq", label: "≤" },
  { keys: ["geq", "ge"], body: "\\geq", label: "≥" },
  { keys: ["neq", "ne"], body: "\\neq", label: "≠" },
  { keys: ["approx"], body: "\\approx", label: "≈" },
  { keys: ["to", "箭头"], body: "\\to", label: "→" },
  { keys: ["Rightarrow"], body: "\\Rightarrow", label: "⇒" },
  { keys: ["in"], body: "\\in", label: "∈" },
  { keys: ["subset"], body: "\\subset", label: "⊂" },
  { keys: ["cup"], body: "\\cup", label: "∪" },
  { keys: ["cap"], body: "\\cap", label: "∩" },
  { keys: ["mathbb", "bb"], body: "\\mathbb{$1}", label: "黑板粗体" },
  { keys: ["mathbf", "bf"], body: "\\mathbf{$1}", label: "粗体" },
  { keys: ["mathrm", "rm"], body: "\\mathrm{$1}", label: "正体" },
  { keys: ["text"], body: "\\text{$1}", label: "文本" },
  {
    keys: ["matrix", "矩阵"],
    body: "\\begin{matrix}\n$1 &  \\\\\n & \n\\end{matrix}",
    label: "matrix",
  },
  {
    keys: ["pmatrix"],
    body: "\\begin{pmatrix}\n$1 &  \\\\\n & \n\\end{pmatrix}",
    label: "pmatrix",
  },
  {
    keys: ["cases", "分段"],
    body: "\\begin{cases}\n$1 \\\\\n\n\\end{cases}",
    label: "cases",
  },
];

function expandBody(body: string): { insert: string; cursorBack: number } {
  const first = body.indexOf("$1");
  const insert = body.replace(/\$\d+/g, "");
  if (first < 0) return { insert, cursorBack: 0 };
  const before = body.slice(0, first).replace(/\$\d+/g, "");
  return { insert, cursorBack: insert.length - before.length };
}

/** 光标前文本 → 最佳补全 */
export function matchLatexCompletion(textBeforeCursor: string): LatexCompletion | null {
  // 匹配可选 \ + 标识符/中文
  const m = textBeforeCursor.match(/(\\)?([a-zA-Z\u4e00-\u9fff]{1,20})$/);
  if (!m) return null;
  const slash = m[1] ?? "";
  const typed = m[2] ?? "";
  if (!typed) return null;
  const lower = typed.toLowerCase();

  type Hit = { snip: Snippet; key: string; score: number };
  let hit: Hit | null = null;

  for (const snip of SNIPPETS) {
    for (const key of snip.keys) {
      const k = key.toLowerCase();
      let score = -1;
      if (key === typed) score = 100; // 中文/精确
      else if (k === lower) score = 90; // 命令名打完
      else if (k.startsWith(lower) && lower.length >= 1) score = 50 + lower.length;
      else continue;

      // 更短 key 优先（frac 优于 frame 之类，若以后有）
      score -= key.length * 0.01;
      if (!hit || score > hit.score) hit = { snip, key, score };
    }
  }
  if (!hit) return null;
  // 至少 1 字符；单字母希腊易误触，要求 ≥2，除非精确中文
  const isCjk = /[\u4e00-\u9fff]/.test(typed);
  if (!isCjk && typed.length < 2 && hit.key.toLowerCase() !== lower) return null;

  const { insert, cursorBack } = expandBody(hit.snip.body);
  const trigger = slash + typed;

  // 已输入与 insert 完全一致则无需补全
  if (trigger === insert) return null;

  return {
    trigger,
    insert,
    cursorBack,
    label: hit.snip.label,
  };
}

/** 幽灵展示：insert 相对 trigger 多出来的部分（trigger 为 insert 前缀时） */
export function latexGhostSuffix(completion: LatexCompletion): string {
  const { trigger, insert } = completion;
  if (insert.startsWith(trigger)) return insert.slice(trigger.length);
  // 无 \ 输入 frac → insert 是 \frac{}{}，幽灵展示整段
  if (!trigger.startsWith("\\") && insert.startsWith("\\")) return insert;
  // 中文别名等：展示完整 insert
  return insert;
}

export function applyLatexCompletion(
  full: string,
  cursor: number,
  completion: LatexCompletion,
): { next: string; cursor: number } {
  const before = full.slice(0, cursor);
  const after = full.slice(cursor);
  const head = before.endsWith(completion.trigger)
    ? before.slice(0, before.length - completion.trigger.length)
    : before;
  const next = head + completion.insert + after;
  const cursorAt = head.length + completion.insert.length - completion.cursorBack;
  return { next, cursor: Math.max(head.length, cursorAt) };
}
