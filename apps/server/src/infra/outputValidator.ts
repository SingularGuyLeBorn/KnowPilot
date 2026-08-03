/**
 * OutputValidator — Agent 产出落盘前的机械化验证门（P0）
 *
 * 设计原则：
 * - 纯函数、无 prisma、无 IO（除 TypeScript 语法解析外）。
 * - 验证器自身抛异常时降级为 ok:true 并 warn，不能 blocker 正常写文件。
 * - 错误信息必须「可执行」：说明错在哪、怎么修。
 */

import * as ts from "typescript";
import matter from "gray-matter";
import path from "path";
import { recordViolation } from "./constraintEvolution.js";
import type { AppConfig } from "./config.js";

export interface OutputValidationError {
  code: string;
  message: string;
  fix: string;
}

export interface OutputValidationResult {
  ok: boolean;
  errors?: OutputValidationError[];
}

/** 常见 Unicode 伪公式符号：应改为 $...$ / $$...$$ LaTeX */
const PSEUDO_MATH_UNICODE_RE = /[√ₖᵀ·Σ≈×÷⊙⊗∗≠≤≥]/u;

/** 更细粒度的检测：列出具体字符，方便给出修复提示 */
const PSEUDO_MATH_CHARS: Record<string, string> = {
  "√": "\\sqrt{...}",
  "ₖ": "_k",
  "ᵀ": "^T",
  "·": "\\cdot",
  "Σ": "\\sum",
  "≈": "\\approx",
  "×": "\\times",
  "÷": "\\div",
  "⊙": "\\odot",
  "⊗": "\\otimes",
  "∗": "\\ast",
  "≠": "\\neq",
  "≤": "\\leq",
  "≥": "\\geq",
};

/**
 * 校验落盘内容。
 * filePath 用于判断文件类型（建议传项目相对路径）。
 */
export function validateOutputContent(filePath: string, content: string): OutputValidationResult {
  try {
    const lowerPath = filePath.toLowerCase();
    const normalizedPath = filePath.replace(/\\/g, "/");
    const errors: OutputValidationError[] = [];

    if (lowerPath.endsWith(".md")) {
      errors.push(...validateMarkdown(normalizedPath, content));
    }

    if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".tsx")) {
      errors.push(...validateTypeScript(filePath, content));
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true };
  } catch (err) {
    console.warn(
      `[outputValidator] 内部异常（已降级放行）:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: true };
  }
}

function validateMarkdown(filePath: string, content: string): OutputValidationError[] {
  const errors: OutputValidationError[] = [];

  // 1. frontmatter 解析 + 字段
  const frontmatterResult = validateFrontmatter(filePath, content);
  if (frontmatterResult) errors.push(frontmatterResult);

  // 内容质量类校验仅针对核心知识库文章（content/ 且非 uploads），
  // 避免对 config/agents/、config/memories/ 等运行时/配置 Markdown 过度拦截。
  const isContentArticle =
    filePath.startsWith("content/") && !filePath.startsWith("content/uploads/");

  if (isContentArticle) {
    // 2. Unicode 伪公式符号
    const pseudo = detectPseudoMath(content);
    if (pseudo) errors.push(pseudo);

    // 3. 图片路径
    errors.push(...validateMarkdownImagePaths(filePath, content));
  }

  return errors;
}

function validateFrontmatter(filePath: string, content: string): OutputValidationError | null {
  const hasFrontmatter = content.trimStart().startsWith("---");
  let data: Record<string, unknown> = {};

  if (hasFrontmatter) {
    try {
      const parsed = matter(content);
      data = parsed.data as Record<string, unknown>;
    } catch (err) {
      return {
        code: "MD_FRONTMATTER_INVALID",
        message: `YAML frontmatter 解析失败：${err instanceof Error ? err.message : String(err)}`,
        fix: "请检查 frontmatter 的 YAML 语法（如引号配对、列表缩进、冒号后空格）。",
      };
    }
  }

  // content/ 下的文章/花园首页/About 必须有 title（uploads 下的媒体文件除外）
  const isContentArticle =
    filePath.startsWith("content/") && !filePath.startsWith("content/uploads/");
  if (isContentArticle) {
    const title = data.title;
    if (title === undefined || title === null || String(title).trim() === "") {
      return {
        code: "MD_FRONTMATTER_MISSING_TITLE",
        message: "content/ 下的 Markdown 文件 frontmatter 缺少 title 字段",
        fix: '请在 frontmatter 顶部补 `title: "文章标题"`。',
      };
    }
  }

  return null;
}

function detectPseudoMath(content: string): OutputValidationError | null {
  const match = PSEUDO_MATH_UNICODE_RE.exec(content);
  if (!match) return null;
  const char = match[0];
  const latex = PSEUDO_MATH_CHARS[char] ?? "LaTeX 命令";
  return {
    code: "MD_PSEUDO_MATH_UNICODE",
    message: `Markdown 正文中发现 Unicode 伪公式符号「${char}」`,
    fix: `数学公式请用 $...$ / $$...$$ 包裹，并改为 LaTeX，如 ${char} → ${latex}。`,
  };
}

function validateMarkdownImagePaths(_filePath: string, content: string): OutputValidationError[] {
  const errors: OutputValidationError[] = [];
  const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = imgRe.exec(content)) !== null) {
    const url = m[1].trim();
    if (!url) {
      errors.push({
        code: "MD_IMAGE_EMPTY_URL",
        message: "Markdown 图片链接为空",
        fix: "请填写图片路径，如 `![](content/uploads/my-image.png)`。",
      });
      continue;
    }
    // 拒绝 Windows 绝对路径
    if (/^[a-zA-Z]:[\\/]/.test(url)) {
      errors.push({
        code: "MD_IMAGE_ABSOLUTE_WINDOWS_PATH",
        message: `图片路径使用了 Windows 绝对路径：${url}`,
        fix: "请把图片放入 content/uploads/ 并使用项目相对路径，如 `content/uploads/my-image.png`。",
      });
      continue;
    }
    // 拒绝 file:// 协议
    if (url.startsWith("file://")) {
      errors.push({
        code: "MD_IMAGE_FILE_PROTOCOL",
        message: `图片路径使用了 file:// 协议：${url}`,
        fix: "请把图片放入 content/uploads/ 并使用项目相对路径。",
      });
      continue;
    }
    // 拒绝 Unix 绝对路径（以 / 开头但不是 URL）
    if (url.startsWith("/") && !url.startsWith("//")) {
      errors.push({
        code: "MD_IMAGE_ABSOLUTE_UNIX_PATH",
        message: `图片路径使用了绝对路径：${url}`,
        fix: "请使用项目相对路径（如 `content/uploads/my-image.png`）或完整 URL（https://...）。",
      });
    }
  }

  return errors;
}

function validateTypeScript(filePath: string, content: string): OutputValidationError[] {
  const errors: OutputValidationError[] = [];
  const ext = path.extname(filePath).toLowerCase();
  const scriptKind = ext === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  try {
    const result = ts.transpileModule(content, {
      compilerOptions: {
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ext === ".tsx" ? ts.JsxEmit.React : ts.JsxEmit.Preserve,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: filePath,
      reportDiagnostics: true,
    });

    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const d of result.diagnostics) {
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        errors.push({
          code: "TS_SYNTAX_ERROR",
          message: `TypeScript 语法错误：${message}`,
          fix: "请检查语句是否完整（如漏写右括号/分号/类型注解），修正后再写入。",
        });
      }
    }
  } catch (err) {
    errors.push({
      code: "TS_VALIDATOR_ERROR",
      message: `TypeScript 校验器内部异常：${err instanceof Error ? err.message : String(err)}`,
      fix: "请检查代码明显语法错误；如确认无误可重试。",
    });
  }

  return errors;
}

/**
 * 带 Agent 身份的校验入口。
 * 校验失败时除返回错误外，还会把错误码记录到该 Agent 的约束进化账本。
 * 如不希望记录（例如测试无 Agent 场景），可继续用纯函数 validateOutputContent。
 */
export function validateOutputForAgent(
  filePath: string,
  content: string,
  agentId: string | null | undefined,
  config?: AppConfig,
): OutputValidationResult {
  const result = validateOutputContent(filePath, content);
  if (!result.ok && agentId) {
    for (const err of result.errors ?? []) {
      recordViolation(agentId, err.code, { filePath, message: err.message }, config);
    }
  }
  return result;
}

/**
 * 批量校验，返回第一个失败结果或 ok。
 * 用于调用方想把多个校验项串起来的场景。
 */
export function formatValidationErrors(errors: OutputValidationError[]): string {
  return errors.map((e) => `[${e.code}] ${e.message}\n修复建议：${e.fix}`).join("\n\n");
}
