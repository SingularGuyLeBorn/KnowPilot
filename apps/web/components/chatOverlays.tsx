"use client";

/**
 * ChatOverlays —— Chat 顶层浮层群（W13e 从 chat.tsx 拆出）。
 * 包含 System Prompt 编辑器弹窗、新建子 Agent 弹窗（SubagentCreateDialog）、toast。
 * 纯结构拆分：open/close 受控态与 chatConfig/updateConfig 仍留在 chat.tsx，经 props 注入；
 * 保持 fixed 层叠顺序不变（prompt 编辑器 → 子 Agent 弹窗 → toast）。
 */

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ChatSessionConfig } from "@knowpilot/shared";
import { buttonVariants } from "@/components/ui/button";
import { SubagentCreateDialog } from "@/components/subagentCreateDialog";

export interface ChatOverlaysProps {
  // System Prompt 编辑器弹窗
  showPromptEditor: boolean;
  setShowPromptEditor: (open: boolean) => void;
  systemPrompt: string;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  // 新建子 Agent 弹窗
  showCreateSubagent: boolean;
  setShowCreateSubagent: (open: boolean) => void;
  parentSessionId: string | undefined;
  parentAgentId: string;
  parentAgentTools: string[] | undefined;
  onSubagentCreated: () => void;
  // toast
  toast: string | null;
}

export function ChatOverlays({
  showPromptEditor,
  setShowPromptEditor,
  systemPrompt,
  updateConfig,
  showCreateSubagent,
  setShowCreateSubagent,
  parentSessionId,
  parentAgentId,
  parentAgentTools,
  onSubagentCreated,
  toast,
}: ChatOverlaysProps) {
  return (
    <>
      {showPromptEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">编辑 System Prompt</h3>
              <button type="button" onClick={() => setShowPromptEditor(false)}><X className="h-4 w-4" /></button>
            </div>
            <textarea value={systemPrompt} onChange={(e) => updateConfig({ systemPrompt: e.target.value, customSystemPrompt: true })} rows={12} className="m-4 flex-1 resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-sm outline-none" />
            <div className="flex justify-end border-t px-4 py-3">
              <button type="button" onClick={() => setShowPromptEditor(false)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>完成</button>
            </div>
          </div>
        </div>
      )}

      <SubagentCreateDialog
        open={showCreateSubagent}
        parentSessionId={parentSessionId}
        parentAgentId={parentAgentId}
        parentAgentTools={parentAgentTools}
        onClose={() => setShowCreateSubagent(false)}
        onCreated={onSubagentCreated}
      />

      {toast && (
        <div
          data-testid="chat-toast"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--kp-brand-light)] bg-[var(--kp-bg-alt)] px-4 py-2 text-xs text-[var(--kp-text-1)] shadow-lg"
        >
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
            {toast}
          </span>
        </div>
      )}
    </>
  );
}
