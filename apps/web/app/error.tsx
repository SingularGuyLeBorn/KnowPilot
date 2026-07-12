"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError] 路由级错误边界捕获:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-8 py-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-[var(--kp-text-1)]">
          页面出了点问题
        </h2>
        <p className="mb-4 text-sm text-[var(--kp-text-2)]">
          渲染过程中发生了异常。可以尝试重试，或返回首页。
        </p>
        {process.env.NODE_ENV !== "production" && (
          <pre className="mb-4 max-h-40 overflow-auto rounded-lg bg-[var(--kp-bg-mute)] p-3 text-left text-xs text-[var(--kp-text-3)]">
            {error.message}
            {error.digest ? `\n digest: ${error.digest}` : ""}
          </pre>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-[var(--kp-brand-deep)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            重试
          </button>
          <a
            href="/"
            className="rounded-lg border border-[var(--kp-divider)] px-4 py-2 text-sm font-medium text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg-mute)]"
          >
            返回首页
          </a>
        </div>
      </div>
    </div>
  );
}
