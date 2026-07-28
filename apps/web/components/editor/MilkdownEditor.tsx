"use client";

import { useEffect, useRef, useState } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { math } from "@milkdown/plugin-math";
import { Code2, Eye } from "lucide-react";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

export type EditorViewMode = "wysiwyg" | "source";

interface MilkdownEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** 受控模式；不传则内部自管 */
  mode?: EditorViewMode;
  onModeChange?: (mode: EditorViewMode) => void;
  className?: string;
}

function MilkdownWysiwyg({
  initialValue = "",
  onChange,
  placeholder,
}: {
  initialValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEditor(
    (root) => {
      const editor = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialValue);

          const l = ctx.get(listenerCtx);
          l.markdownUpdated((_, markdown) => {
            onChangeRef.current?.(markdown);
          });

          if (placeholder) {
            root.setAttribute("data-placeholder", placeholder);
          }
        })
        .use(commonmark)
        .use(math)
        .use(listener);

      return editor;
    },
    [], // 只挂载一次；外部用 key remount
  );

  return <Milkdown />;
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: EditorViewMode;
  onChange: (m: EditorViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange("wysiwyg")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition",
          mode === "wysiwyg"
            ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
            : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
        )}
        title="所见即所得（点击公式可编辑源码）"
      >
        <Eye className="h-3.5 w-3.5" />
        预览
      </button>
      <button
        type="button"
        onClick={() => onChange("source")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition",
          mode === "source"
            ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
            : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
        )}
        title="Markdown 源码"
      >
        <Code2 className="h-3.5 w-3.5" />
        源码
      </button>
    </div>
  );
}

function MilkdownEditorInner({
  initialValue = "",
  onChange,
  placeholder,
  mode: controlledMode,
  onModeChange,
  className,
}: MilkdownEditorProps) {
  const [internalMode, setInternalMode] = useState<EditorViewMode>("wysiwyg");
  const mode = controlledMode ?? internalMode;
  const [wysiwygEpoch, setWysiwygEpoch] = useState(0);
  const setMode = (m: EditorViewMode) => {
    if (m === "wysiwyg" && mode === "source") {
      // 源码 → 预览：用最新 draft remount Milkdown
      setWysiwygEpoch((n) => n + 1);
    }
    onModeChange?.(m);
    if (controlledMode === undefined) setInternalMode(m);
  };

  // 源码 ↔ WYSIWYG：markdown 字符串为单一事实源。
  // 外部重置内容靠父级 key remount（勿在 effect 里 setDraft）。
  const [draft, setDraft] = useState(initialValue);

  const handleChange = (next: string) => {
    setDraft(next);
    onChange?.(next);
  };

  return (
    <div
      className={cn(
        "milkdown-editor flex h-full min-h-[400px] flex-col rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--kp-divider)] px-3 py-2">
        <p className="text-[11px] text-[var(--kp-text-3)]">
          {mode === "wysiwyg"
            ? "所见即所得 · 点击公式进入编辑，只改当前公式"
            : "Markdown 源码模式"}
        </p>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {mode === "source" ? (
        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder || "写 Markdown…"}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent px-4 py-4 font-mono text-sm leading-relaxed text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)]"
        />
      ) : (
        <div className="min-h-0 flex-1">
          <MilkdownProvider key={`md-provider-${wysiwygEpoch}`}>
            <MilkdownWysiwyg
              key={`wysiwyg-${wysiwygEpoch}`}
              initialValue={draft}
              onChange={handleChange}
              placeholder={placeholder}
            />
          </MilkdownProvider>
        </div>
      )}
    </div>
  );
}

/**
 * Obsidian 式：默认 WYSIWYG（含公式渲染/点选编辑）+ 可切源码。
 * 切换模式时以当前 markdown 字符串为准，避免双份状态漂移。
 */
export function MilkdownEditor(props: MilkdownEditorProps) {
  return <MilkdownEditorInner {...props} />;
}

export function MilkdownStyles() {
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "kp-milkdown-styles";
    if (document.getElementById(style.id)) return;
    style.textContent = `
      .milkdown-editor > div:last-child {
        flex: 1 1 0%;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .milkdown-editor .milkdown {
        flex: 1 1 0%;
        min-height: 0;
        padding: 1.25rem 1.5rem 2rem;
        outline: none;
        color: var(--kp-text-1);
        background: var(--kp-bg);
        overflow: auto;
      }
      .milkdown-editor .milkdown .ProseMirror {
        min-height: 320px;
        outline: none;
      }
      .milkdown-editor .milkdown p {
        margin: 0.75rem 0;
        line-height: 1.8;
      }
      .milkdown-editor .milkdown h1,
      .milkdown-editor .milkdown h2,
      .milkdown-editor .milkdown h3,
      .milkdown-editor .milkdown h4 {
        margin: 1.5rem 0 0.75rem;
        font-weight: 600;
        color: var(--kp-text-1);
        line-height: 1.35;
      }
      .milkdown-editor .milkdown h1 { font-size: 1.75rem; }
      .milkdown-editor .milkdown h2 { font-size: 1.4rem; }
      .milkdown-editor .milkdown h3 { font-size: 1.2rem; }
      .milkdown-editor .milkdown blockquote {
        border-left: 4px solid var(--kp-brand);
        padding-left: 1rem;
        color: var(--kp-text-2);
        margin: 1rem 0;
      }
      .milkdown-editor .milkdown code {
        background: var(--kp-bg-mute);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-size: 0.875em;
      }
      .milkdown-editor .milkdown pre {
        background: var(--kp-bg-mute);
        padding: 1rem;
        border-radius: 0.75rem;
        overflow-x: auto;
      }
      .milkdown-editor .milkdown ul,
      .milkdown-editor .milkdown ol {
        padding-left: 1.5rem;
        margin: 0.75rem 0;
      }
      .milkdown-editor .milkdown li { margin: 0.25rem 0; }
      .milkdown-editor .milkdown a {
        color: var(--kp-brand-deep);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .milkdown-editor .milkdown hr {
        border: none;
        border-top: 1px solid var(--kp-divider);
        margin: 1.5rem 0;
      }
      /* 公式：渲染态可点；编辑态输入框只包住当前公式 */
      .milkdown-editor .milkdown .math-inline,
      .milkdown-editor .milkdown span[data-type="math_inline"] {
        cursor: pointer;
        border-radius: 0.25rem;
        padding: 0 0.15rem;
        transition: background 0.15s ease;
      }
      .milkdown-editor .milkdown .math-inline:hover,
      .milkdown-editor .milkdown span[data-type="math_inline"]:hover {
        background: color-mix(in oklab, var(--kp-brand) 12%, transparent);
      }
      .milkdown-editor .milkdown .math-block,
      .milkdown-editor .milkdown div[data-type="math_block"] {
        cursor: pointer;
        margin: 1rem 0;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        background: var(--kp-bg-mute);
        overflow-x: auto;
      }
      .milkdown-editor .milkdown .math-block:hover,
      .milkdown-editor .milkdown div[data-type="math_block"]:hover {
        outline: 1px solid color-mix(in oklab, var(--kp-brand) 35%, transparent);
      }
      .milkdown-editor .milkdown .ProseMirror-selectednode.math-inline,
      .milkdown-editor .milkdown .ProseMirror-selectednode.math-block {
        outline: 2px solid var(--kp-brand);
        outline-offset: 2px;
      }
      .milkdown-editor .milkdown [data-placeholder]:empty::before {
        content: attr(data-placeholder);
        color: var(--kp-text-3);
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById("kp-milkdown-styles")?.remove();
    };
  }, []);

  return null;
}
