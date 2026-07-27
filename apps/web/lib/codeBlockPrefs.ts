"use client";

import { useCallback, useSyncExternalStore } from "react";

/** 代码块行号显示：全局偏好，localStorage 持久化，所有 PostContent 代码块同步 */
const STORAGE_KEY = "kp-code-show-line-numbers";
const listeners = new Set<() => void>();

function readStored(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useShowCodeLineNumbers(): [boolean, (next: boolean) => void] {
  const show = useSyncExternalStore(subscribe, readStored, () => true);

  const setShow = useCallback((next: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    // 同页各代码块靠 listeners；跨标签靠原生 storage 事件
    emit();
  }, []);

  return [show, setShow];
}
