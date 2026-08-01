"use client";

/**
 * 流式期轻量渲染：不做 remark/rehype/高亮，但保留行内 code/bold/数学公式，
 * 解决 Thinking 过程中 LaTeX 下标（$x_l$、$$x_{l+1}$$）被原样显示为下划线的问题。
 * 终态 / 非 live 仍走完整 PostContent。
 */

import { memo, useEffect, useMemo, type ReactNode } from "react";
import katex from "katex";
import { cn } from "@/lib/utils";
import { warmKatexFonts } from "@/components/post/KatexHtml";

function InlineKatex({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        strict: false,
        output: "html",
      });
    } catch {
      return tex;
    }
  }, [tex]);
  /* inline-block + leading-none：与终态 .katex 隔离策略一致 */
  return <span className="inline-block align-baseline leading-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

function DisplayKatex({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        strict: false,
        displayMode: true,
        output: "html",
      });
    } catch {
      return tex;
    }
  }, [tex]);
  return <div className="my-2 text-center leading-normal" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderInline(text: string): ReactNode[] {
  // 极简：code / **bold** / $inline math$；其余原样（避免流式半截语法抖动）
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\$[^$\n]+\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const token = m[0]!;
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-[var(--kp-bg-mute)] px-1 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(<InlineKatex key={key++} tex={token.slice(1, -1)} />);
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export const StreamingPlainContent = memo(function StreamingPlainContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = useMemo(() => {
    if (!content) return null;
    // 同时处理 ``` 代码块与 $$ 块级公式，其余当正文做行内渲染
    const parts = content.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```") && part.endsWith("```") && part.length >= 6) {
        const inner = part.slice(3, -3);
        const nl = inner.indexOf("\n");
        const code = nl >= 0 ? inner.slice(nl + 1) : inner;
        return (
          <pre
            key={i}
            className="my-2 overflow-x-auto rounded-lg bg-[var(--kp-bg-mute)] p-3 font-mono text-[12px] leading-relaxed"
          >
            {code}
          </pre>
        );
      }
      if (part.startsWith("$$") && part.endsWith("$$") && part.length >= 4) {
        const tex = part.slice(2, -2).trim();
        return <DisplayKatex key={i} tex={tex} />;
      }
      return (
        <span key={i} className="whitespace-pre-wrap break-words">
          {renderInline(part)}
        </span>
      );
    });
  }, [content]);

  useEffect(() => {
    if (content.includes("$")) warmKatexFonts();
  }, [content]);

  return (
    <div
      data-testid="streaming-plain-content"
      className={cn("text-sm leading-relaxed text-[var(--kp-text-1)]", className)}
      spellCheck={false}
    >
      {blocks}
    </div>
  );
});
