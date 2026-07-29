"use client";

/**
 * Canvas 式选区工具条：划选正文 → 润色 / 精简 / 扩写 / 自定义 → 交给 EditorAgentComplete。
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Minimize2, Maximize2, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EditorAgentCompleteApi } from "@/components/editor/EditorAgentComplete";

const QUICK_ACTIONS = [
  { id: "polish", label: "润色", instruction: "润色选中段落：更流畅、专业，保持原意与 Markdown 结构，只输出改写后的正文。", icon: Sparkles },
  { id: "shorten", label: "精简", instruction: "精简选中段落：删冗余，保留要点与术语，只输出改写后的正文。", icon: Minimize2 },
  { id: "expand", label: "扩写", instruction: "扩写选中段落：补充必要解释与例子，语气一致，只输出改写后的正文。", icon: Maximize2 },
  { id: "custom", label: "自定义", instruction: "", icon: PenLine },
] as const;

type Anchor = { top: number; left: number };

export type EditorSelectionToolbarProps = {
  /** 编辑器根节点（含 WYSIWYG / 源码） */
  containerRef: React.RefObject<HTMLElement | null>;
  mode: "wysiwyg" | "source";
  sourceTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  agentApiRef: React.RefObject<EditorAgentCompleteApi | null>;
  /** WYSIWYG：保存并读取 ProseMirror 选区 */
  onSaveWysiwygSelection: () => { text: string } | null;
  className?: string;
};

function readSourceSelection(
  ta: HTMLTextAreaElement | null,
  content: string,
): { text: string; start: number; end: number } | null {
  if (!ta) return null;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  if (start === end) return null;
  const text = content.slice(start, end);
  if (!text.trim()) return null;
  return { text, start, end };
}

export function EditorSelectionToolbar({
  containerRef,
  mode,
  sourceTextareaRef,
  content,
  agentApiRef,
  onSaveWysiwygSelection,
  className,
}: EditorSelectionToolbarProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [snap, setSnap] = useState<{
    text: string;
    start?: number;
    end?: number;
    wysiwyg: boolean;
  } | null>(null);

  const hide = useCallback(() => {
    setAnchor(null);
    setSnap(null);
  }, []);

  const updateFromSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (mode === "source") {
      const sel = readSourceSelection(sourceTextareaRef.current, content);
      if (!sel) {
        hide();
        return;
      }
      const ta = sourceTextareaRef.current;
      if (!ta) return;
      // 用 textarea 近似定位：选区中点
      const rect = ta.getBoundingClientRect();
      setSnap({ text: sel.text, start: sel.start, end: sel.end, wysiwyg: false });
      setAnchor({
        top: Math.max(8, rect.top + 8),
        left: Math.min(rect.left + rect.width / 2, window.innerWidth - 160),
      });
      return;
    }

    const domSel = window.getSelection();
    if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) {
      hide();
      return;
    }
    const range = domSel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      hide();
      return;
    }
    // 点在工具条上时不刷掉
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (el?.closest("[data-kp-selection-toolbar]")) return;

    const pm = onSaveWysiwygSelection();
    if (!pm?.text.trim()) {
      hide();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hide();
      return;
    }
    setSnap({ text: pm.text, wysiwyg: true });
    setAnchor({
      top: Math.max(8, rect.top - 44),
      left: Math.min(
        Math.max(12, rect.left + rect.width / 2 - 120),
        window.innerWidth - 260,
      ),
    });
  }, [containerRef, mode, sourceTextareaRef, content, onSaveWysiwygSelection, hide]);

  useEffect(() => {
    const onMouseUp = () => {
      window.setTimeout(updateFromSelection, 0);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
      else window.setTimeout(updateFromSelection, 0);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [updateFromSelection, hide]);

  const runAction = (instruction: string) => {
    if (!snap) return;
    const api = agentApiRef.current;
    if (!api) return;
    api.openForRewrite({
      instruction,
      selected: snap.text,
      start: snap.start,
      end: snap.end,
      wysiwyg: snap.wysiwyg,
    });
    hide();
  };

  if (!anchor || !snap || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-kp-selection-toolbar
      className={cn(
        "fixed z-[80] flex items-center gap-0.5 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-0.5 shadow-lg",
        className,
      )}
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {QUICK_ACTIONS.map(({ id, label, instruction, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={instruction || "自定义指令改写选区"}
          onClick={() => runAction(instruction)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--kp-text-2)] hover:bg-[var(--kp-brand-soft)] hover:text-[var(--kp-brand-deep)]"
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
