/** 路由切换即时反馈骨架（配合各段 loading.tsx） */

export function RouteLoading() {
  return (
    <div
      className="flex flex-1 flex-col gap-4 px-6 py-8"
      role="status"
      aria-label="页面加载中"
    >
      <div className="h-8 w-44 animate-pulse rounded-lg bg-[var(--kp-bg-mute)]" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded bg-[var(--kp-bg-mute)]" />
      <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl bg-[var(--kp-bg-mute)]"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export default RouteLoading;
