"use client";

/**
 * useChatHoverMonitor —— 会话列表悬停预览（右上角监控小窗口，默认关闭，对话设置可开）。
 *
 * 【悬停预览域】原 chat.tsx 开关关闭清理 effect + 悬停防抖定时器及其卸载清理
 * （原 unmount 清理 effect 的 hover 段）随域收拢；state 与四个 handler 一并内聚。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useSessionHoverPreview } from "@/lib/hooks";
import { sessionMessagesStore } from "@/lib/useSessionMessages";

export function useChatHoverMonitor(opts: { effectiveSessionId: string | null }) {
  const { effectiveSessionId } = opts;
  const utils = trpc.useUtils();
  const [hoverMonitorSessionId, setHoverMonitorSessionId] = useState<string | null>(null);
  const { enabled: sessionHoverPreviewEnabled } = useSessionHoverPreview();
  const hoverMonitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 外部状态（hover preview 开关）变更时同步清理 UI 状态，非派生数据
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sessionHoverPreviewEnabled) setHoverMonitorSessionId(null);
  }, [sessionHoverPreviewEnabled]);

  // 卸载时清理悬停防抖定时器（原 chat.tsx unmount 清理 effect 的 hover 段，随域内聚）
  useEffect(() => {
    return () => {
      if (hoverMonitorTimeoutRef.current) {
        clearTimeout(hoverMonitorTimeoutRef.current);
        hoverMonitorTimeoutRef.current = null;
      }
    };
  }, []);

  // 悬停即预热 MessageStore（不依赖预览开关）；预览窗另开
  const handleSessionHover = useCallback(
    (id: string) => {
      if (!id || id === effectiveSessionId) return;
      void sessionMessagesStore.prefetchSessionMessages(id, (opts) =>
        utils.message.listForChat.fetch(opts),
      );
      if (!sessionHoverPreviewEnabled) return;
      if (hoverMonitorTimeoutRef.current) clearTimeout(hoverMonitorTimeoutRef.current);
      setHoverMonitorSessionId(id);
    },
    [utils, effectiveSessionId, sessionHoverPreviewEnabled],
  );

  const handleSessionHoverEnd = useCallback((id: string) => {
    hoverMonitorTimeoutRef.current = setTimeout(() => {
      setHoverMonitorSessionId((current) => (current === id ? null : current));
    }, 200);
  }, []);

  const handleHoverMonitorEnter = useCallback(() => {
    if (hoverMonitorTimeoutRef.current) clearTimeout(hoverMonitorTimeoutRef.current);
  }, []);

  const handleHoverMonitorLeave = useCallback(() => {
    hoverMonitorTimeoutRef.current = setTimeout(() => {
      setHoverMonitorSessionId(null);
    }, 200);
  }, []);

  return {
    sessionHoverPreviewEnabled,
    hoverMonitorSessionId,
    setHoverMonitorSessionId,
    handleSessionHover,
    handleSessionHoverEnd,
    handleHoverMonitorEnter,
    handleHoverMonitorLeave,
  };
}
