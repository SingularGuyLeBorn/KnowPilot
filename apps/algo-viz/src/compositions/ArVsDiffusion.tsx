/**
 * ArVsDiffusion — 自回归 vs 掩码扩散（左右对照，教学向）
 *
 * 设计：light paper background (#F7F8FA), dark ink, formula highlight, caption strip
 * 嵌入：阅读 UI 内算法讲解片
 * 比例：1280×720 / 30fps / 480帧
 */

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* ─── Props ─── */

export const DEFAULT_PROPS = {
  prompt: "床前明月",
  genTokens: ["光", "疑", "是", "地", "上", "霜"],
} as const;

export interface ArVsDiffusionProps {
  prompt?: string;
  genTokens?: string[];
  title?: string;
}

/* ─── 颜色语义（浅色主题） ─── */

const C = {
  bg: "#F7F8FA",
  ink: "#1a1a2e",
  muted: "#8b8ba7",
  panelBg: "#ffffff",
  panelBorder: "#e2e4ed",
  ar: "#3b82f6",      // blue
  arBg: "rgba(59,130,246,0.06)",
  diff: "#10b981",    // green
  diffBg: "rgba(16,185,129,0.06)",
  mask: "#d1d5db",
  maskInk: "#9ca3af",
  flash: "#f59e0b",   // amber
  captionBg: "#ffffff",
  captionBorder: "#e2e4ed",
  formulaBg: "#f0fdf4",
} as const;

/* ─── 尺寸 ─── */

const CELL_W = 52;
const CELL_H = 60;
const GAP = 8;

/* ─── 辅助 ─── */

function fade(frame: number, start: number, end: number) {
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/* ─── Token 格 ─── */

const TokenCell: React.FC<{
  char: string;
  mode: "prompt" | "mask" | "ar" | "diff";
  highlight?: boolean;
  pop?: number;
}> = ({ char, mode, highlight, pop = 1 }) => {
  const isMask = mode === "mask";
  const isPrompt = mode === "prompt";

  const bg = isMask
    ? "#f3f4f6"
    : mode === "ar"
      ? C.arBg
      : mode === "diff"
        ? C.diffBg
        : "#ffffff";
  const border = highlight
    ? C.flash
    : isMask
      ? C.mask
      : isPrompt
        ? "#e5e7eb"
        : mode === "ar"
          ? C.ar
          : C.diff;
  const color = isMask
    ? C.maskInk
    : isPrompt
      ? C.muted
      : C.ink;

  return (
    <div
      style={{
        width: CELL_W,
        height: CELL_H,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        border: `2px solid ${border}`,
        boxShadow: highlight ? `0 0 0 3px ${C.flash}40` : "0 1px 3px rgba(0,0,0,0.06)",
        transform: `scale(${pop})`,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: isMask ? 13 : 20,
          fontWeight: 700,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color,
        }}
      >
        {isMask ? "?" : char}
      </span>
    </div>
  );
};

/* ─── 主组件 ─── */

export const ArVsDiffusion: React.FC<ArVsDiffusionProps> = ({
  prompt = DEFAULT_PROPS.prompt,
  genTokens = DEFAULT_PROPS.genTokens,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const promptChars = useMemo(() => Array.from(prompt), [prompt]);
  const genChars = useMemo(() => genTokens.flatMap(t => Array.from(t)).filter(Boolean).slice(0, 8), [genTokens]);

  const pLen = promptChars.length;
  const gLen = genChars.length;

  // 时间线
  const SETUP = 25;
  const AR_PER = 15;
  const DIFF_STEPS = 5;
  const DIFF_PER = 24;

  // AR 揭示
  const arCount = frame < SETUP ? 0 : Math.min(gLen, Math.floor((frame - SETUP) / AR_PER) + 1);
  const arJustIdx = arCount > 0 && arCount <= gLen ? arCount - 1 : -1;
  const arLocal = arJustIdx >= 0 ? frame - SETUP - arJustIdx * AR_PER : 0;
  const arPop = arJustIdx >= 0
    ? spring({ frame: arLocal, fps, config: { damping: 14, stiffness: 200 } })
    : 1;

  // 扩散批次：打乱顺序
  const diffBatches = useMemo(() => {
    const order: number[] = [];
    const mid = Math.floor(gLen / 2);
    const used = new Set<number>();
    const push = (i: number) => { if (i >= 0 && i < gLen && !used.has(i)) { used.add(i); order.push(i); } };
    push(mid); push(mid - 1); push(mid + 1);
    for (let d = 2; d < gLen; d++) { push(mid - d); push(mid + d); }
    for (let i = 0; i < gLen; i++) push(i);
    const batches: number[][] = Array.from({ length: DIFF_STEPS }, () => []);
    order.forEach((idx, i) => { batches[Math.min(Math.floor(i * DIFF_STEPS / order.length), DIFF_STEPS - 1)]!.push(idx); });
    return batches;
  }, [gLen]);

  const diffStep = frame < SETUP ? -1 : Math.min(DIFF_STEPS - 1, Math.floor((frame - SETUP) / DIFF_PER));
  const diffLocal = diffStep >= 0 ? frame - SETUP - diffStep * DIFF_PER : 0;
  const diffFlash = diffStep >= 0 && diffLocal < 12;
  const diffCommit = diffStep >= 0 && diffLocal >= 12;

  const diffRevealStepOf = useMemo(() => {
    const map = new Array(gLen).fill(DIFF_STEPS);
    diffBatches.forEach((b, s) => { for (const i of b) map[i] = s; });
    return map;
  }, [diffBatches, gLen]);

  const diffRevealed = (i: number) => {
    if (diffStep < 0) return false;
    const rs = diffRevealStepOf[i]!;
    if (diffStep > rs) return true;
    if (diffStep === rs) return diffCommit;
    return false;
  };

  const diffJustRev = (i: number) => diffCommit && diffStep >= 0 && diffRevealStepOf[i] === diffStep && diffLocal < 22;

  // 布局 2×2 象限
  const showAr = frame >= 0;
  const showDiff = frame >= 10;

  const diffCells: React.ReactNode[] = [];
  for (let i = 0; i < gLen; i++) {
    const r = diffRevealed(i);
    const fl = diffFlash && diffStep >= 0 && diffRevealStepOf[i] === diffStep && !r;
    const jr = diffJustRev(i);
    diffCells.push(
      <TokenCell key={"d" + i} char={genChars[i]!} mode={r ? "diff" : "mask"} highlight={fl}
        pop={jr ? spring({ frame: Math.max(0, diffLocal - 12), fps, config: { damping: 14, stiffness: 200 } }) : 1} />
    );
  }

  const arCells: React.ReactNode[] = [];
  for (let i = 0; i < gLen; i++) {
    const shown = i < arCount;
    const justShown = i === arJustIdx;
    arCells.push(
      <TokenCell key={"a" + i} char={genChars[i]!} mode={shown ? "ar" : "mask"} highlight={justShown && arLocal < 8}
        pop={justShown ? arPop : 1} />
    );
  }

  const diffShown = diffCells.filter((_, i) => diffRevealed(i)).length;

  let caption = "";
  if (frame < SETUP) caption = "";
  else {
    const arDone = arCount >= gLen;
    const diffDone = diffStep >= DIFF_STEPS - 1 && diffCommit;
    if (arDone && diffDone) caption = "两者都完成！注意：AR 顺序固定（左→右）；扩散并行揭示（非固定顺序）。";
    else if (!arDone && diffDone) caption = `AR 生成中… 第 ${arCount + 1}/${gLen} 个。扩散已全部揭示。`;
    else if (arDone && !diffDone) caption = `AR 完成。扩散去噪中… 第 ${Math.max(0, diffStep) + 1}/${DIFF_STEPS} 步，已揭示 ${diffShown}/${gLen}。`;
    else caption = `AR 第 ${arCount}/${gLen} · 扩散第 ${Math.max(0, diffStep) + 1}/${DIFF_STEPS} 步 (${diffShown}/${gLen} 已揭示)`;
  }

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: "system-ui, -apple-system, sans-serif", color: C.ink }}>

      {/* 标题 */}
      <div style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", opacity: fade(frame, 5, 20) }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>自回归（AR）</span>
        <span style={{ fontSize: 16, fontWeight: 400, color: C.muted, margin: "0 24px" }}>vs</span>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>掩码扩散（Diffusion）</span>
      </div>

      {/* 左：AR */}
      <div style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", opacity: fade(frame, 5, 20) }}>
        <div style={{
          background: C.arBg, padding: "12px 16px", borderRadius: 10,
          border: `1px solid ${C.ar}40`, minWidth: 120,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ar }}>Prompt</span>
          <div style={{ display: "flex", gap: 4 }}>
            {promptChars.map((c, i) => (
              <div key={i} style={{
                width: 38, height: 42, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#ffffff", border: `1px solid ${C.panelBorder}`,
              }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: C.muted }}>{c}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.ar }}>AR 生成 →</span>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", maxWidth: 340 }}>
            {arCells}
          </div>
        </div>
      </div>

      {/* 右：扩散 */}
      <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", opacity: fade(frame, 10, 25) }}>
        <div style={{
          background: C.diffBg, padding: "12px 16px", borderRadius: 10,
          border: `1px solid ${C.diff}40`, minWidth: 120,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.diff }}>扩散去噪</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", maxWidth: 340 }}>
            {diffCells}
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.diff }}>
              步 {Math.max(0, diffStep + 1)}/{DIFF_STEPS} · 并行
            </span>
          </div>
        </div>
      </div>

      {/* Caption */}
      <div style={{
        position: "absolute", left: 32, right: 32, bottom: 12, minHeight: 48,
        padding: "10px 18px", borderRadius: 10, background: C.captionBg, border: `1px solid ${C.panelBorder}`,
        display: "flex", alignItems: "center", opacity: fade(frame, 10, 25),
      }}>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: C.ink, fontWeight: 500 }}>
          {frame < SETUP ? "即将开始：左边 AR（逐位生成），右边掩码扩散（并行去噪）…" : caption}
        </span>
      </div>
    </AbsoluteFill>
  );
};

export default ArVsDiffusion;
