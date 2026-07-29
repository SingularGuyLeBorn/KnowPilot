"use client";

import { useCallback, useEffect, useState } from "react";

export type CardDensity = "comfortable" | "compact";

const CARD_DENSITY_KEY = "kp-card-density";
const CARD_DENSITY_CHANGE_EVENT = "kp-card-density-change";

function readSavedDensity(): CardDensity {
  try {
    const saved = localStorage.getItem(CARD_DENSITY_KEY);
    if (saved === "comfortable" || saved === "compact") return saved;
  } catch {
    // ignore
  }
  return "comfortable";
}

/** 实体卡片密度偏好（localStorage）；叶子模块，避免经 hooks.ts 大桶拉进 CRUD */
export function useCardDensity() {
  // 水合约束：SSR 与客户端首帧必须相同，localStorage 只在 mount 后读
  const [density, setDensityState] = useState<CardDensity>("comfortable");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDensityState(readSavedDensity());
    const handler = () => setDensityState(readSavedDensity());
    window.addEventListener(CARD_DENSITY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CARD_DENSITY_CHANGE_EVENT, handler);
  }, []);

  const setDensity = useCallback((d: CardDensity) => {
    setDensityState(d);
    try {
      localStorage.setItem(CARD_DENSITY_KEY, d);
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent(CARD_DENSITY_CHANGE_EVENT));
  }, []);

  const toggle = useCallback(() => {
    setDensity(density === "compact" ? "comfortable" : "compact");
  }, [density, setDensity]);

  return { density, setDensity, toggle };
}
