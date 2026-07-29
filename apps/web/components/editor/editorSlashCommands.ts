/**
 * 飞书式编辑器斜杠命令：/gs 公式、/code 代码、/hb 画板、/tb 表格…
 * 源码模式与 WYSIWYG 共用命令表与替换逻辑。
 */

export type EditorSlashCommandId =
  | "math"
  | "code"
  | "board"
  | "table"
  | "h1"
  | "h2"
  | "h3";

export interface EditorSlashCommand {
  id: EditorSlashCommandId;
  /** 主快捷码（飞书：公式 gs / 代码 code·dm / 画板 hb / 表格 tb） */
  alias: string;
  /** 额外别名 */
  aliases: string[];
  title: string;
  description: string;
}

export const EDITOR_SLASH_COMMANDS: EditorSlashCommand[] = [
  {
    id: "math",
    alias: "gs",
    aliases: ["gs", "eq", "math", "latex", "公式"],
    title: "公式",
    description: "插入空的 LaTeX 公式块",
  },
  {
    id: "code",
    alias: "code",
    aliases: ["code", "dm", "代码", "代码块"],
    title: "代码块",
    description: "插入空代码块",
  },
  {
    id: "table",
    alias: "tb",
    aliases: ["tb", "table", "bg", "表格"],
    title: "表格",
    description: "插入 3×3 表格",
  },
  {
    id: "board",
    alias: "hb",
    aliases: ["hb", "board", "画板"],
    title: "画板",
    description: "手写白板（钢笔/荧光笔/压感）",
  },
  {
    id: "h1",
    alias: "h1",
    aliases: ["h1", "bt1", "一级标题"],
    title: "一级标题",
    description: "将当前行设为一级标题",
  },
  {
    id: "h2",
    alias: "h2",
    aliases: ["h2", "bt2", "二级标题"],
    title: "二级标题",
    description: "将当前行设为二级标题",
  },
  {
    id: "h3",
    alias: "h3",
    aliases: ["h3", "bt3", "三级标题"],
    title: "三级标题",
    description: "将当前行设为三级标题",
  },
];

export function filterSlashCommands(query: string): EditorSlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return EDITOR_SLASH_COMMANDS;
  return EDITOR_SLASH_COMMANDS.filter((cmd) => {
    if (cmd.title.includes(query.trim())) return true;
    return cmd.aliases.some((a) => a.toLowerCase().startsWith(q) || a.toLowerCase() === q);
  });
}

/** 精确命中（回车直接执行，无需点选） */
export function resolveExactSlashCommand(query: string): EditorSlashCommand | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    EDITOR_SLASH_COMMANDS.find((cmd) => cmd.aliases.some((a) => a.toLowerCase() === q)) ?? null
  );
}

/** 行首或空白后的 /query */
const SLASH_TOKEN_RE = /(?:^|[\s\n])(\/([\w\u4e00-\u9fff-]*))$/;

export function matchSlashToken(textBeforeCursor: string): { token: string; query: string } | null {
  const m = textBeforeCursor.match(SLASH_TOKEN_RE);
  if (!m) return null;
  return { token: m[1] ?? "", query: m[2] ?? "" };
}

export const EMPTY_BOARD_JSON = JSON.stringify(
  {
    v: 2,
    w: 960,
    h: 540,
    strokes: [] as Array<{
      color: string;
      size: number;
      points: number[];
      tool: "pen" | "highlighter";
    }>,
  },
  null,
  0,
);

export const EMPTY_TABLE_MD = `| 列1 | 列2 | 列3 |
| --- | --- | --- |
|  |  |  |
|  |  |  |
`;

/** 源码模式：把光标前的斜杠命令换成对应 Markdown */
export function applySlashInSource(
  value: string,
  cursor: number,
  cmd: EditorSlashCommand,
): { next: string; cursor: number } | null {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const hit = matchSlashToken(before);
  if (!hit) return null;
  const start = cursor - hit.token.length;
  const prefix = value.slice(0, start);
  const needNlBefore = prefix.length > 0 && !prefix.endsWith("\n");
  const nl = needNlBefore ? "\n" : "";
  let snippet = "";
  let cursorOffset = 0;
  switch (cmd.id) {
    case "math":
      snippet = `${nl}$$\n\n$$\n`;
      cursorOffset = nl.length + 3;
      break;
    case "code":
      snippet = `${nl}\`\`\`\n\n\`\`\`\n`;
      cursorOffset = nl.length + 4; // ```\n 之后，落在代码体内
      break;
    case "board":
      snippet = `${nl}\`\`\`kp-board\n${EMPTY_BOARD_JSON}\n\`\`\`\n`;
      cursorOffset = snippet.length;
      break;
    case "table":
      snippet = `${nl}${EMPTY_TABLE_MD}`;
      cursorOffset = nl.length + 2; // 落在首格
      break;
    case "h1":
      snippet = `${nl}# `;
      cursorOffset = snippet.length;
      break;
    case "h2":
      snippet = `${nl}## `;
      cursorOffset = snippet.length;
      break;
    case "h3":
      snippet = `${nl}### `;
      cursorOffset = snippet.length;
      break;
    default:
      return null;
  }
  const next = prefix + snippet + after;
  return { next, cursor: start + cursorOffset };
}
