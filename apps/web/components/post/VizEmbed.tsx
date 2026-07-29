"use client";

/**
 * Markdown 围栏 ```viz … ``` → 浏览器内 Remotion Player。
 * Player 与 composition 必须同一次动态加载、同一份 remotion（见 next.config alias）。
 *
 * 高度契约：loading / Player / 错误态共用同一外框尺寸，禁止 skeleton→Player 跳变
 * 触发 Virtuoso ResizeObserver 把聊天滚到顶部。
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  normalizeVizSrc,
  parseVizFence,
  type VizSpec,
} from "@/components/post/vizFence";

export type { VizSpec };
export { parseVizFence } from "@/components/post/vizFence";

type AlgoVizEntry = {
  id: string;
  component: ComponentType<Record<string, unknown>>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, unknown>;
};

type PlayerComponent = typeof import("@remotion/player").Player;

/** 固定宽高比外框（padding 非 margin，进 Virtuoso 测量）；教学默认白底 */
function VizFrame({
  title,
  aspectRatio,
  children,
}: {
  title?: string;
  aspectRatio: string;
  children: ReactNode;
}) {
  return (
    <figure
      data-no-edit-click
      className="not-prose my-0 overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-white"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {title ? (
        <figcaption className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-2.5 text-sm font-medium text-[var(--kp-text-1)]">
          {title}
        </figcaption>
      ) : null}
      <div className="relative w-full bg-white" style={{ aspectRatio }}>
        {children}
      </div>
    </figure>
  );
}

function CompositionPlayer(props: {
  compositionId: string;
  title?: string;
  extraProps: Record<string, unknown>;
}) {
  // compositionId 变则 remount，loading 初值即可，勿在 effect 里同步 setLoading
  return <CompositionPlayerInner key={props.compositionId} {...props} />;
}

function CompositionPlayerInner({
  compositionId,
  title,
  extraProps,
}: {
  compositionId: string;
  title?: string;
  extraProps: Record<string, unknown>;
}) {
  const [Player, setPlayer] = useState<PlayerComponent | null>(null);
  const [entry, setEntry] = useState<AlgoVizEntry | null>(null);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 同一次 Promise：Player + registry 共用 webpack 对 remotion 的 alias 解析
    Promise.all([import("@remotion/player"), import("@knowpilot/algo-viz")])
      .then(([playerMod, algoMod]) => {
        if (cancelled) return;
        setPlayer(() => playerMod.Player);
        setKnownIds(Object.keys(algoMod.ALGO_VIZ_REGISTRY));
        setEntry(algoMod.getAlgoViz(compositionId));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compositionId]);

  const inputProps = useMemo(() => {
    if (!entry) return {};
    return { ...entry.defaultProps, ...extraProps };
  }, [entry, extraProps]);

  // loading 与 Player 共用同一 aspect，避免首次挂载/播放撑高把列表顶飞
  const aspectRatio = entry
    ? `${entry.width} / ${entry.height}`
    : "16 / 9";

  if (loading) {
    return (
      <VizFrame title={title} aspectRatio={aspectRatio}>
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--kp-text-3)]">
          加载动画组件…
        </div>
      </VizFrame>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-[var(--kp-text-2)]">
        动画引擎加载失败：{loadError}
      </div>
    );
  }

  if (!entry || !Player) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-[var(--kp-text-2)]">
        未知 composition：<code className="font-mono">{compositionId}</code>
        。已注册：{knownIds.join(", ") || "（无）"}
      </div>
    );
  }

  return (
    <VizFrame title={title} aspectRatio={aspectRatio}>
      <Player
        component={entry.component}
        durationInFrames={entry.durationInFrames}
        compositionWidth={entry.width}
        compositionHeight={entry.height}
        fps={entry.fps}
        controls
        loop
        autoPlay={false}
        clickToPlay
        inputProps={inputProps}
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
      />
    </VizFrame>
  );
}

export function VizEmbed({ raw }: { raw: string }) {
  const spec = parseVizFence(raw);
  if (!spec) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-[var(--kp-text-2)]">
        无效的 <code className="font-mono">viz</code> 块。请写{" "}
        <code className="font-mono">composition: PpoClip</code>
      </div>
    );
  }

  if (spec.composition) {
    return (
      <CompositionPlayer
        compositionId={spec.composition}
        title={spec.title}
        extraProps={spec.props}
      />
    );
  }

  if (spec.src) {
    const src = normalizeVizSrc(spec.src);
    return (
      <VizFrame title={spec.title} aspectRatio="16 / 9">
        <video
          className="absolute inset-0 h-full w-full bg-black object-contain"
          src={src}
          poster={spec.poster ? normalizeVizSrc(spec.poster) : undefined}
          controls
          playsInline
          preload="metadata"
        />
      </VizFrame>
    );
  }

  return null;
}
