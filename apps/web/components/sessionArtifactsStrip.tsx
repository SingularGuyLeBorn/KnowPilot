"use client";

/**
 * 会话级产物条（DeerFlow Artifacts 启发）：SSE artifact_created → 可点路径提示。
 */

import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { formatToolDisplayName, toPascalCaseId } from "@/lib/toolDisplayName";

export type SessionArtifact = {
  artifactKind: string;
  title?: string;
  path: string;
  mime?: string;
  toolCallId: string;
  toolName: string;
  at: number;
};

export function SessionArtifactsStrip({ sessionId }: { sessionId: string | null }) {
  const [items, setItems] = useState<SessionArtifact[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    const onArt = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as SessionArtifact & { sessionId?: string };
      if (detail.sessionId && detail.sessionId !== sessionId) return;
      setItems((prev) => {
        if (prev.some((p) => p.path === detail.path && p.toolCallId === detail.toolCallId)) {
          return prev;
        }
        return [{ ...detail, at: Date.now() }, ...prev].slice(0, 8);
      });
    };
    window.addEventListener("kp:artifact-created", onArt);
    return () => window.removeEventListener("kp:artifact-created", onArt);
  }, [sessionId]);

  if (!sessionId || items.length === 0) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="session-artifacts-strip">
      {items.map((a) => (
        <div
          key={`${a.toolCallId}-${a.path}`}
          className="flex items-center gap-2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/90 px-3 py-2 text-xs"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[var(--kp-text-2)]">
              {a.title || toPascalCaseId(a.artifactKind)} · {formatToolDisplayName(a.toolName)}
            </div>
            <div className="truncate font-mono text-[10px] text-[var(--kp-text-3)]" title={a.path}>
              {a.path}
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            aria-label="关闭"
            onClick={() => setItems((prev) => prev.filter((p) => p.toolCallId !== a.toolCallId))}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
