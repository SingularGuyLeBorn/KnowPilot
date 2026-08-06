/**
 * 客户端路由跳转进度信号（无第三方依赖）。
 * NavigationProgress 订阅；需要时可手动 beginNavigation()。
 */

type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let active = false;

export function subscribeNavigationProgress(listener: Listener): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}

export function beginNavigation(): void {
  if (active) return;
  active = true;
  for (const l of listeners) l(true);
}

export function endNavigation(): void {
  if (!active) return;
  active = false;
  for (const l of listeners) l(false);
}

export function isNavigationPending(): boolean {
  return active;
}
