"use client";

/**
 * 流式期轻量渲染：不做 remark/rehype/KaTeX/高亮，只保空白与极简行内标记。
 * 终态 / 非 live 仍走完整 PostContent。
 */

import { memo, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function renderInline(text: string): ReactNode[] {
  // 极简：`code` 与 **bold**；其余原样（避免流式半截语法抖动）
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
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
    } else {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
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
    // 简易 fenced code：完整闭合的 ``` 块按 pre 渲染，未闭合尾块仍当正文
    const parts = content.split(/(```[\s\S]*?```)/g);
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
      return (
        <span key={i} className="whitespace-pre-wrap break-words">
          {renderInline(part)}
        </span>
      );
    });
  }, [content]);

  return (
    <div
      data-testid="streaming-plain-content"
      className={cn("text-sm leading-relaxed text-[var(--kp-text-1)]", className)}
    >
      {blocks}
    </div>
  );
});
