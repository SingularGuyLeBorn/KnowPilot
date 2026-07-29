"use client";

/**
 * Markdown 围栏 ```viz … ``` → 浏览器内 Remotion Player（代码驱动，默认不落 MP4）。
 *
 * ```viz
 * composition: PpoClip
 * title: PPO-Clip
 * epsilon: 0.2
 * ```
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ALGO_VIZ_REGISTRY, getAlgoViz } from "@knowpilot/algo-viz";

export type VizSpec = {
  composition?: string;
  src?: string;
  title?: string;
  poster?: string;
  props: Record<string, unknown>;
};

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseVizFence(raw: string): VizSpec | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const map: Record<string, string> = {};
  for (const line of lines) {
    const m = /^([a-zA-Z_][\w-]*)\s*:\s*(.+)$/.exec(line);
    if (m) {
      map[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    if (lines.length === 1 && !line.includes(":")) {
      if (line.startsWith("/") || /^https?:\/\//i.test(line)) {
        return { src: line, props: {} };
      }
      return { composition: line, props: {} };
    }
  }

  const reserved = new Set([
    "composition",
    "comp",
    "src",
    "url",
    "video",
    "title",
    "caption",
    "poster",
  ]);
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (reserved.has(k)) continue;
    props[k] = parseScalar(v);
  }

  const composition = map.composition || map.comp;
  const src = map.src || map.url || map.video;
  if (!composition && !src) return null;

  return {
    composition,
    src,
    title: map.title || map.caption,
    poster: map.poster,
    props,
  };
}

function normalizeSrc(src: string): string {
  if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
  if (src.startsWith("content/uploads/")) return `/${src.slice("content/".length)}`;
  if (src.startsWith("uploads/")) return `/${src}`;
  return src;
}

const RemotionPlayer = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  {
    ssr: false,
    loading: () => (
      <div className="flex aspect-video w-full items-center justify-center bg-black text-sm text-white/60">
        加载动画引擎…
      </div>
    ),
  },
);

function CompositionPlayer({
  compositionId,
  title,
  extraProps,
}: {
  compositionId: string;
  title?: string;
  extraProps: Record<string, unknown>;
}) {
  const entry = getAlgoViz(compositionId);
  const inputProps = useMemo(() => {
    if (!entry) return {};
    return { ...entry.defaultProps, ...extraProps };
  }, [entry, extraProps]);

  if (!entry) {
    return (
      <div className="my-6 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-[var(--kp-text-2)]">
        未知 composition：<code className="font-mono">{compositionId}</code>
        。已注册：{Object.keys(ALGO_VIZ_REGISTRY).join(", ")}
      </div>
    );
  }

  return (
    <figure className="my-6 not-prose overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-black">
      {title ? (
        <figcaption className="border-b border-white/10 bg-[var(--kp-bg-alt)] px-4 py-2.5 text-sm font-medium text-[var(--kp-text-1)]">
          {title}
        </figcaption>
      ) : null}
      <RemotionPlayer
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
        style={{ width: "100%", aspectRatio: `${entry.width} / ${entry.height}` }}
      />
    </figure>
  );
}

export function VizEmbed({ raw }: { raw: string }) {
  const spec = parseVizFence(raw);
  if (!spec) {
    return (
      <div className="my-6 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-[var(--kp-text-2)]">
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
    const src = normalizeSrc(spec.src);
    return (
      <figure className="my-6 not-prose overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]">
        {spec.title ? (
          <figcaption className="border-b border-[var(--kp-divider)] px-4 py-2.5 text-sm font-medium text-[var(--kp-text-1)]">
            {spec.title}
          </figcaption>
        ) : null}
        <video
          className="aspect-video w-full bg-black"
          src={src}
          poster={spec.poster ? normalizeSrc(spec.poster) : undefined}
          controls
          playsInline
          preload="metadata"
        />
      </figure>
    );
  }

  return null;
}
