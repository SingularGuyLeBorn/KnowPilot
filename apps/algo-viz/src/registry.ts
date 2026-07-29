/**
 * 给花园前端 Remotion Player 用的注册表（不 registerRoot，避免污染 Next）。
 * Studio / CLI 仍走 src/index.ts。
 */
import type { ComponentType } from "react";
import {
  PpoClip,
  PPO_CLIP_DURATION,
  PPO_CLIP_FPS,
  PPO_CLIP_HEIGHT,
  PPO_CLIP_WIDTH,
} from "./compositions/PpoClip";

export type AlgoVizEntry = {
  id: string;
  component: ComponentType<Record<string, unknown>>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, unknown>;
};

export const ALGO_VIZ_REGISTRY: Record<string, AlgoVizEntry> = {
  PpoClip: {
    id: "PpoClip",
    component: PpoClip as ComponentType<Record<string, unknown>>,
    durationInFrames: PPO_CLIP_DURATION,
    fps: PPO_CLIP_FPS,
    width: PPO_CLIP_WIDTH,
    height: PPO_CLIP_HEIGHT,
    defaultProps: {
      epsilon: 0.2,
      title: "PPO-Clip：信任域的一阶近似",
    },
  },
};

export function getAlgoViz(id: string): AlgoVizEntry | null {
  return ALGO_VIZ_REGISTRY[id] ?? ALGO_VIZ_REGISTRY[id.trim()] ?? null;
}

export { PpoClip, PPO_CLIP_DURATION, PPO_CLIP_FPS, PPO_CLIP_HEIGHT, PPO_CLIP_WIDTH };
