"use client";

/**
 * 市面主流做法：katex.renderToString + dangerouslySetInnerHTML。
 * 不把 KaTeX 的空 strut/pstrut span 拆成 React 子树（易丢节点 → 下标飞掉）。
 */

import { memo, useEffect, useMemo } from "react";
import katex from "katex";
import { KatexFormula } from "@/components/post/KatexFormula";

let katexFontsWarmStarted = false;

/** 首次出现公式时预热关键字体（不阻塞、不藏公式）；StreamingPlainContent 共用 */
export function warmKatexFonts() {
  if (katexFontsWarmStarted || typeof document === "undefined") return;
  katexFontsWarmStarted = true;
  if (!document.fonts?.load) return;
  const specs = [
    "1em KaTeX_Main",
    "italic 1em KaTeX_Main",
    "bold 1em KaTeX_Main",
    "italic 1em KaTeX_Math",
    "1em KaTeX_Size1",
    "1em KaTeX_AMS",
  ];
  Promise.all(specs.map((s) => document.fonts.load(s).catch(() => undefined))).catch(
    () => undefined,
  );
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      strict: false,
      displayMode,
      output: "html",
    });
  } catch {
    return tex;
  }
}

export const KatexHtml = memo(function KatexHtml({
  tex,
  display = false,
}: {
  tex: string;
  display?: boolean;
}) {
  const trimmed = tex.trim();
  const html = useMemo(() => renderKatex(trimmed, display), [trimmed, display]);

  useEffect(() => {
    if (trimmed) warmKatexFonts();
  }, [trimmed]);

  if (!trimmed) return null;

  if (display) {
    // KatexFormula 直接吃官方 HTML（已含 .katex-display），不再套 React 子树
    return <KatexFormula display html={html} tex={trimmed} />;
  }

  return (
    <span
      className="inline-block align-baseline leading-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
