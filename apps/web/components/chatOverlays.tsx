"use client";

/**
 * ChatOverlays —— Chat 顶层浮层群（W13e 从 chat.tsx 拆出）。
 * 包含 System Prompt 编辑器弹窗、新建子 Agent 弹窗（SubagentCreateDialog）、toast。
 * 纯结构拆分：open/close 受控态与 chatConfig/updateConfig 仍留在 chat.tsx，经 props 注入；
 * 保持 fixed 层叠顺序不变（prompt 编辑器 → 子 Agent 弹窗 → toast）。
 *
 * W16b：React.memo 渲染屏障——浮层群 props 不含流式派生值，流式期跳过重渲染。
 */

import { memo, useState } from "react";
import { Check, Eye, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ChatSessionConfig } from "@knowpilot/shared";
import { buttonVariants } from "@/components/ui/button";
import { SubagentCreateDialog } from "@/components/subagentCreateDialog";
import { PostContent } from "@/components/post/PostContent";

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

export const ChatOverlays = memo(function ChatOverlays({
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
        <SystemPromptEditorDialog
          systemPrompt={systemPrompt}
          onChange={(value) => updateConfig({ systemPrompt: value, customSystemPrompt: true })}
          onClose={() => setShowPromptEditor(false)}
        />
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
});

/** 编辑源码 / 预览 Markdown：送模仍是纯文本，预览只是看排版 */
function SystemPromptEditorDialog({
  systemPrompt,
  onChange,
  onClose,
}: {
  systemPrompt: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-xl"
        data-testid="system-prompt-editor"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--kp-divider-light)] px-4 py-3">
          <h3 className="font-semibold text-[var(--kp-text-1)]">编辑系统提示</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-[var(--kp-bg-mute)] p-0.5">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                  mode === "edit"
                    ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                    : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
                )}
                data-testid="system-prompt-tab-edit"
              >
                <Pencil className="h-3 w-3" />
                编辑
              </button>
              <button
                type="button"
                onClick={() => setMode("preview")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                  mode === "preview"
                    ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                    : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
                )}
                data-testid="system-prompt-tab-preview"
              >
                <Eye className="h-3 w-3" />
                预览
              </button>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭">
              <X className="h-4 w-4 text-[var(--kp-text-3)]" />
            </button>
          </div>
        </div>
        {mode === "edit" ? (
          <textarea
            value={systemPrompt}
            onChange={(e) => onChange(e.target.value)}
            rows={16}
            className="m-4 min-h-[280px] flex-1 resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 font-mono text-sm leading-relaxed text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
            data-testid="system-prompt-textarea"
            spellCheck={false}
          />
        ) : (
          <div
            className="m-4 min-h-[280px] flex-1 overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-4"
            data-testid="system-prompt-preview"
          >
            {systemPrompt.trim() ? (
              <PostContent
                content={systemPrompt}
                className="prose-sm max-w-none text-left text-[var(--kp-text-1)] [&_table]:text-xs [&_th]:px-2 [&_td]:px-2"
              />
            ) : (
              <p className="text-sm text-[var(--kp-text-3)]">（空提示）</p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-[var(--kp-divider-light)] px-4 py-3">
          <p className="text-[10px] text-[var(--kp-text-3)]">送模始终是源码；预览仅方便阅读排版</p>
          <button
            type="button"
            onClick={onClose}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
