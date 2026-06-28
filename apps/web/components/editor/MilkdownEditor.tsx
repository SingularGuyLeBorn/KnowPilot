"use client";

import { useEffect, useRef } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { listener, listenerCtx } from "@milkdown/plugin-listener";

interface MilkdownEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

function MilkdownEditorInner({
  initialValue = "",
  onChange,
  placeholder,
}: MilkdownEditorProps) {
  // 保存 onChange 的最新引用，避免在 editor 配置的回调中产生闭包陈旧值
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
        .use(listener);

      return editor;
    },
    [] // 只在挂载时初始化一次，防止初值更新导致编辑器在每次击键时被销毁重建，造成无法输入和失去焦点
  );

  return (
    <div className="milkdown-editor flex h-full min-h-[400px] flex-col rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]">
      <Milkdown />
    </div>
  );
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

// Milkdown 需要全局样式
export function MilkdownStyles() {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      .milkdown-editor > div {
        flex: 1 1 0%;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .milkdown-editor .milkdown {
        flex: 1 1 0%;
        min-height: 0;
        padding: 1.5rem;
        outline: none;
        color: var(--kp-text-1);
        background: var(--kp-bg);
      }
      .milkdown-editor .milkdown p {
        margin: 0.75rem 0;
        line-height: 1.75;
      }
      .milkdown-editor .milkdown h1,
      .milkdown-editor .milkdown h2,
      .milkdown-editor .milkdown h3 {
        margin: 1.5rem 0 0.75rem;
        color: var(--kp-text-1);
      }
      .milkdown-editor .milkdown blockquote {
        border-left: 4px solid var(--kp-brand);
        padding-left: 1rem;
        color: var(--kp-text-2);
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
      .milkdown-editor .milkdown [data-placeholder]:empty::before {
        content: attr(data-placeholder);
        color: var(--kp-text-3);
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return null;
}
