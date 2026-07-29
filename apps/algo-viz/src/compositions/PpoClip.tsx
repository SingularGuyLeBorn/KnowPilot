import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const PPO_CLIP_FPS = 30;
export const PPO_CLIP_DURATION = 720;
export const PPO_CLIP_WIDTH = 1280;
export const PPO_CLIP_HEIGHT = 720;

type Props = {
  epsilon: number;
  title: string;
};

const BG = "#0b1020";
const INK = "#e8eef7";
const MUTED = "#8b9bb4";
const ACCENT = "#c9f36a";
const WARN = "#ff7658";
const BAND = "rgba(201, 243, 106, 0.16)";
const AXIS = "#3a4560";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function fade(frame: number, inStart: number, inEnd: number, outStart: number, outEnd: number) {
  const enter = interpolate(frame, [inStart, inEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [outStart, outEnd], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return Math.min(enter, exit);
}

/** 将 r∈[0.4,1.6] 映射到图面 x */
function rToX(r: number, left: number, right: number) {
  return left + ((r - 0.4) / 1.2) * (right - left);
}

export const PpoClip: React.FC<Props> = ({ epsilon, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const left = 160;
  const right = 1120;
  const axisY = 390;
  const rOne = rToX(1, left, right);
  const rLo = rToX(1 - epsilon, left, right);
  const rHi = rToX(1 + epsilon, left, right);

  const titleIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 28 });
  const formulaIn = fade(frame, 20, 48, 80, 100);
  const axisIn = fade(frame, 90, 120, 700, 720);
  const bandIn = fade(frame, 120, 160, 700, 720);

  // A>0：r 从 1 → 1.45
  const posPhase = clamp01(interpolate(frame, [220, 380], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const rPos = 1 + posPhase * 0.45;
  const posActive = frame >= 210 && frame < 420;

  // A<0：r 从 1 → 0.55
  const negPhase = clamp01(interpolate(frame, [430, 580], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const rNeg = 1 - negPhase * 0.45;
  const negActive = frame >= 420 && frame < 600;

  const resolveIn = fade(frame, 600, 640, 700, 720);

  let caption = "概率比 r(θ) = π_θ(a|s) / π_old(a|s)";
  if (frame >= 120 && frame < 210) {
    caption = `安全更新带：[1−ε, 1+ε] = [${(1 - epsilon).toFixed(1)}, ${(1 + epsilon).toFixed(1)}]`;
  } else if (posActive) {
    caption =
      rPos > 1 + epsilon
        ? "A>0：r 越过 1+ε → 目标被夹住，继续加大 r 无效"
        : "A>0：动作优于预期，希望提高该动作概率（增大 r）";
  } else if (negActive) {
    caption =
      rNeg < 1 - epsilon
        ? "A<0：r 越过 1−ε → 目标被夹住，继续压小 r 无效"
        : "A<0：动作劣于预期，希望降低该动作概率（减小 r）";
  } else if (frame >= 600) {
    caption = "Clip ≈ 信任域的一阶软墙：一次迭代不要走太远";
  }

  const markerR = posActive ? rPos : negActive ? rNeg : 1;
  const markerX = rToX(markerR, left, right);
  const outside =
    (posActive && markerR > 1 + epsilon) || (negActive && markerR < 1 - epsilon);
  const markerColor = outside ? MUTED : posActive ? ACCENT : negActive ? WARN : ACCENT;

  const objRaw = posActive
    ? markerR * 1
    : negActive
      ? markerR * -1
      : 0;
  const objClipped = posActive
    ? Math.min(markerR, 1 + epsilon) * 1
    : negActive
      ? Math.max(markerR, 1 - epsilon) * -1
      : 0;

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: "Segoe UI, system-ui, sans-serif" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(201,243,106,0.08), transparent 45%), radial-gradient(ellipse at 90% 80%, rgba(255,118,88,0.07), transparent 40%)",
        }}
      />

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 48,
          left: 64,
          right: 64,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 16}px)`,
        }}
      >
        <div style={{ color: MUTED, fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Algo Viz · PPO
        </div>
        <div style={{ color: INK, fontSize: 40, fontWeight: 650, marginTop: 8, letterSpacing: "-0.03em" }}>
          {title}
        </div>
      </div>

      {/* Formula card */}
      <div
        style={{
          position: "absolute",
          top: 150,
          left: 64,
          right: 64,
          opacity: formulaIn,
          color: INK,
          fontSize: 26,
          fontFamily: "Cambria, Georgia, serif",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "18px 24px",
        }}
      >
        L<sup>CLIP</sup>(θ) = E [ min( r·A , clip(r, 1−ε, 1+ε)·A ) ]
      </div>

      {/* Axis + band */}
      <div style={{ opacity: axisIn }}>
        <div
          style={{
            position: "absolute",
            left: rLo,
            top: axisY - 52,
            width: rHi - rLo,
            height: 104,
            background: BAND,
            border: `1px solid ${ACCENT}`,
            borderRadius: 12,
            opacity: bandIn,
          }}
        />
        <div
          style={{
            position: "absolute",
            left,
            top: axisY,
            width: right - left,
            height: 3,
            background: AXIS,
            borderRadius: 2,
          }}
        />
        {/* ticks */}
        {[0.6, 0.8, 1, 1.2, 1.4].map((r) => {
          const x = rToX(r, left, right);
          return (
            <React.Fragment key={r}>
              <div
                style={{
                  position: "absolute",
                  left: x,
                  top: axisY - 8,
                  width: 2,
                  height: 19,
                  background: r === 1 ? INK : AXIS,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: x - 18,
                  top: axisY + 18,
                  width: 36,
                  textAlign: "center",
                  color: r === 1 ? INK : MUTED,
                  fontSize: 16,
                }}
              >
                {r.toFixed(1)}
              </div>
            </React.Fragment>
          );
        })}
        <div style={{ position: "absolute", left: rLo - 10, top: axisY - 78, color: ACCENT, fontSize: 16 }}>
          1−ε
        </div>
        <div style={{ position: "absolute", left: rHi - 10, top: axisY - 78, color: ACCENT, fontSize: 16 }}>
          1+ε
        </div>
        <div style={{ position: "absolute", left: rOne - 28, top: axisY + 48, color: MUTED, fontSize: 15 }}>
          r = 1（旧策略）
        </div>
      </div>

      {/* Marker */}
      {(posActive || negActive) && (
        <div
          style={{
            position: "absolute",
            left: markerX - 14,
            top: axisY - 14,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: markerColor,
            boxShadow: `0 0 0 6px ${markerColor}33`,
          }}
        />
      )}

      {/* Objective readout */}
      {(posActive || negActive) && (
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            top: 500,
            display: "flex",
            gap: 24,
          }}
        >
          <Metric
            label="未裁剪项 r·A"
            value={objRaw.toFixed(2)}
            color={outside ? MUTED : INK}
            strike={outside}
          />
          <Metric label="裁剪后目标" value={objClipped.toFixed(2)} color={ACCENT} />
          <Metric
            label="优势 A"
            value={posActive ? "+1（示意）" : "−1（示意）"}
            color={posActive ? ACCENT : WARN}
          />
        </div>
      )}

      {/* Caption */}
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 48,
          color: INK,
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        {caption}
      </div>

      {/* Resolve panel */}
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 200,
          opacity: resolveIn,
          padding: 28,
          borderRadius: 20,
          background: "rgba(12,18,36,0.92)",
          border: `1px solid ${ACCENT}55`,
          color: INK,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 650, marginBottom: 12 }}>带走这一句</div>
        <div style={{ fontSize: 22, lineHeight: 1.55, color: MUTED }}>
          PPO-Clip 不直接算 KL 硬约束，而是把概率比夹在 [1−ε, 1+ε]：优势为正时防止「过度加分」，
          优势为负时防止「过度扣分」——一次更新别走出信任域。
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Metric: React.FC<{
  label: string;
  value: string;
  color: string;
  strike?: boolean;
}> = ({ label, value, color, strike }) => (
  <div
    style={{
      flex: 1,
      padding: "14px 16px",
      borderRadius: 14,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}
  >
    <div style={{ color: MUTED, fontSize: 13, marginBottom: 6 }}>{label}</div>
    <div
      style={{
        color,
        fontSize: 28,
        fontWeight: 650,
        textDecoration: strike ? "line-through" : "none",
        opacity: strike ? 0.55 : 1,
      }}
    >
      {value}
    </div>
  </div>
);
