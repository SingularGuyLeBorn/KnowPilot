"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { math } from "@milkdown/plugin-math";
import { history } from "@milkdown/plugin-history";
import { Code2, Eye } from "lucide-react";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import {
  detectEditorAgentAtTrigger,
  EditorAgentComplete,
  type EditorAgentCompleteApi,
  type EditorCompleteDocMeta,
} from "@/components/editor/EditorAgentComplete";
import { EditorSelectionToolbar } from "@/components/editor/EditorSelectionToolbar";
import { BoardEditorModal } from "@/components/editor/BoardCanvas";
import {
  applySlashInSource,
  resolveExactSlashCommand,
  filterSlashCommands,
  matchSlashToken,
} from "@/components/editor/editorSlashCommands";
import {
  configureEditorSlash,
  editorSlash,
  type BoardInsertRequest,
} from "@/components/editor/milkdownEditorSlash";
import { commonmarkWithAbsoluteHeading } from "@/components/editor/headingLevelInputRule";
import {
  mathBlockEditableView,
  mathInlineEditableView,
} from "@/components/editor/mathBlockNodeView";
import { mathBlockAlignExtend } from "@/components/editor/mathBlockAlignSchema";
import {
  registerFormulaCopilot,
  setFormulaCopilotDocMeta,
} from "@/components/editor/mathFormulaCopilot";
import { emptyCodeBlockDeleteKeymap } from "@/components/editor/emptyCodeBlockDelete";
import {
  milkdownLinkNav,
  setMilkdownLinkNavMeta,
} from "@/components/editor/milkdownLinkNav";
import {
  beginMilkdownImageUpload,
  insertMilkdownImageAtCursor,
  milkdownImageUpload,
  setMilkdownImageUploader,
} from "@/components/editor/milkdownImageUpload";
import {
  milkdownSelectionApi,
  replaceMilkdownSelectionWithMarkdown,
  saveMilkdownSelectionRange,
} from "@/components/editor/milkdownSelectionApi";
import {
  ImageUploadButton,
  imageToMarkdown,
  useImageUploader,
  type UploadedImage,
} from "@/components/editor/ImageUploadButton";
import { trpc } from "@/lib/trpc";

export type EditorViewMode = "wysiwyg" | "source";

interface MilkdownEditorProps {
  initialValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** 受控模式；不传则内部自管 */
  mode?: EditorViewMode;
  onModeChange?: (mode: EditorViewMode) => void;
  /** 供 @Agent 补全注入文章元信息 */
  docMeta?: EditorCompleteDocMeta;
  /** Ctrl+S 手动保存 */
  onManualSave?: () => void | Promise<void>;
  className?: string;
}

function MilkdownWysiwyg({
  initialValue = "",
  onChange,
  placeholder,
  boardHookRef,
  linkNavGarden,
  linkNavSlug,
}: {
  initialValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  boardHookRef: MutableRefObject<BoardInsertRequest | null>;
  linkNavGarden?: string;
  linkNavSlug?: string;
}) {
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    setMilkdownLinkNavMeta({ garden: linkNavGarden, slug: linkNavSlug });
  }, [linkNavGarden, linkNavSlug]);

  useEditor(
    (root) => {
      setMilkdownLinkNavMeta({ garden: linkNavGarden, slug: linkNavSlug });
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

          configureEditorSlash(ctx, {
            onOpenBoard: (api) => boardHookRef.current?.onOpenBoard(api),
          });
        })
        .use(commonmarkWithAbsoluteHeading())
        .use(gfm)
        .use(math)
        .use(mathBlockAlignExtend)
        .use(mathBlockEditableView)
        .use(mathInlineEditableView)
        .use(emptyCodeBlockDeleteKeymap)
        .use(milkdownLinkNav)
        .use(milkdownImageUpload)
        .use(milkdownSelectionApi)
        .use(history)
        .use(listener)
        .use(editorSlash);

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
        title="所见即所得 · Ctrl+S · Ctrl+V 粘贴图片 · /gs 公式 · /code 代码 · /tb 表格 · /hb 画板 · 清空后 Backspace 删块"
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
  docMeta,
  onManualSave,
  className,
}: MilkdownEditorProps) {
  const [internalMode, setInternalMode] = useState<EditorViewMode>("wysiwyg");
  const mode = controlledMode ?? internalMode;
  const [wysiwygEpoch, setWysiwygEpoch] = useState(0);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [atTrigger, setAtTrigger] = useState<{ token: number; query: string } | null>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const boardHookRef = useRef<BoardInsertRequest | null>(null);
  const [boardModal, setBoardModal] = useState<{
    initialRaw?: string;
    isNew?: boolean;
    writeBoard: (raw: string) => void;
    removeBoard: () => void;
  } | null>(null);

  useEffect(() => {
    boardHookRef.current = {
      onOpenBoard: (api) => {
        setBoardModal({
          initialRaw: api.initialRaw,
          isNew: api.isNew,
          writeBoard: api.writeBoard,
          removeBoard: api.removeBoard,
        });
      },
    };
  });

  const trpcUtils = trpc.useUtils();
  const editorRootRef = useRef<HTMLDivElement>(null);
  const agentApiRef = useRef<EditorAgentCompleteApi | null>(null);
  const registerAgentApi = useCallback((api: EditorAgentCompleteApi | null) => {
    agentApiRef.current = api;
  }, []);
  const uploadMeta = {
    garden: docMeta?.garden,
    slug: docMeta?.slug || (docMeta?.garden ? "_draft" : undefined),
  };
  const { upload: uploadImage, uploading: imageUploading } = useImageUploader(uploadMeta);

  useEffect(() => {
    setMilkdownImageUploader(async (file) => {
      const image = await uploadImage(file);
      if (!image) return null;
      return { src: image.url, alt: image.alt };
    });
    return () => setMilkdownImageUploader(null);
  }, [uploadImage]);

  useEffect(() => {
    setFormulaCopilotDocMeta({
      title: docMeta?.title,
      garden: docMeta?.garden,
      slug: docMeta?.slug,
    });
  }, [docMeta?.title, docMeta?.garden, docMeta?.slug]);

  useEffect(() => {
    registerFormulaCopilot(async (req) => {
      try {
        const res = await trpcUtils.client.agent.formulaCopilot.mutate({
          before: req.before,
          after: req.after,
          partial: req.partial,
          title: req.title,
          garden: req.garden,
          slug: req.slug,
        });
        if (req.signal?.aborted) return null;
        return { latex: res.latex };
      } catch {
        if (req.signal?.aborted) return null;
        return null;
      }
    });
    return () => registerFormulaCopilot(null);
  }, [trpcUtils]);

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

  const rewriteContent = (next: string, cursor?: number) => {
    handleChange(next);
    if (cursor != null) {
      pendingCursorRef.current = cursor;
      requestAnimationFrame(() => {
        const ta = sourceRef.current;
        if (!ta || pendingCursorRef.current == null) return;
        ta.focus();
        ta.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
        pendingCursorRef.current = null;
      });
    }
  };

  const insertUploadedImage = (image: UploadedImage) => {
    const md = imageToMarkdown(image);
    if (mode === "wysiwyg") {
      const ok = insertMilkdownImageAtCursor({ src: image.url, alt: image.alt });
      if (!ok) {
        // 编辑器尚未就绪时退化为文末追加并 remount
        const base = sourceRef.current?.value ?? draft;
        rewriteContent(`${base}${md}`);
        setWysiwygEpoch((n) => n + 1);
      }
      return;
    }
    const ta = sourceRef.current;
    const current = ta?.value ?? draft;
    if (!ta) {
      rewriteContent(`${current}${md}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = current.slice(0, start) + md + current.slice(end);
    rewriteContent(next, start + md.length);
  };

  const handleSourcePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const ext = file.type.split("/")[1] || "png";
    const named =
      file.name && file.name !== "image.png"
        ? file
        : new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const altBase = named.name.replace(/\.[^/.]+$/, "") || "image";
    const token = `kp-uploading://${Date.now().toString(36)}`;
    const placeholder = `\n![上传中… ${altBase}](${token})\n`;
    const current = ta.value;
    const withPlaceholder = current.slice(0, start) + placeholder + current.slice(end);
    rewriteContent(withPlaceholder, start + placeholder.length);

    uploadImage(named)
      .then((image) => {
        const live = sourceRef.current?.value ?? withPlaceholder;
        const base = live.includes(placeholder) ? live : withPlaceholder;
        if (!image) {
          rewriteContent(base.replace(placeholder, ""));
          return;
        }
        rewriteContent(base.replace(placeholder, imageToMarkdown(image)));
      })
      .catch(() => {
        const live = sourceRef.current?.value ?? withPlaceholder;
        const base = live.includes(placeholder) ? live : withPlaceholder;
        rewriteContent(base.replace(placeholder, ""));
      });
  };

  useEffect(() => {
    if (mode !== "source" || pendingCursorRef.current == null) return;
    const ta = sourceRef.current;
    if (!ta) return;
    const c = pendingCursorRef.current;
    pendingCursorRef.current = null;
    ta.focus();
    ta.setSelectionRange(c, c);
  }, [mode, draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void onManualSave?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onManualSave]);

  return (
    <div
      ref={editorRootRef}
      className={cn(
        "milkdown-editor flex min-h-[calc(100dvh-12rem)] flex-col rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]",
        className,
      )}
    >
      <div className="flex items-center justify-end gap-3 border-b border-[var(--kp-divider)] px-3 py-2">
        <span className="sr-only">
          {mode === "wysiwyg"
            ? "所见即所得。Ctrl+S 保存。Ctrl+V 粘贴图片。划选可润色。斜杠命令：/gs 公式、/code 代码、/tb 表格、/hb 画板。"
            : "源码模式。Ctrl+S 保存。Ctrl+V 粘贴图片。划选可润色。"}
        </span>
        <div className="flex items-center gap-2">
          {imageUploading && (
            <span className="text-xs text-[var(--kp-text-3)]">图片上传中…</span>
          )}
          <ImageUploadButton
            meta={uploadMeta}
            onUploaded={insertUploadedImage}
            interceptFile={
              mode === "wysiwyg"
                ? (file) => beginMilkdownImageUpload(file)
                : undefined
            }
          />
          <EditorAgentComplete
            content={draft}
            sourceTextareaRef={sourceRef}
            docMeta={docMeta}
            atTrigger={atTrigger}
            registerApi={registerAgentApi}
            onPreferSourceMode={() => setMode("source")}
            onRewriteContent={rewriteContent}
            onApply={({ insertStart, insertEnd, content: snippet, wysiwyg }) => {
              if (wysiwyg) {
                if (!replaceMilkdownSelectionWithMarkdown(snippet)) {
                  // 回退：文末追加
                  rewriteContent(`${draft}\n\n${snippet}`);
                  setWysiwygEpoch((n) => n + 1);
                }
                return;
              }
              const next = draft.slice(0, insertStart) + snippet + draft.slice(insertEnd);
              const cursor = insertStart + snippet.length;
              rewriteContent(next, cursor);
              if (mode === "wysiwyg") setWysiwygEpoch((n) => n + 1);
            }}
          />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      <EditorSelectionToolbar
        containerRef={editorRootRef}
        mode={mode}
        sourceTextareaRef={sourceRef}
        content={draft}
        agentApiRef={agentApiRef}
        onSaveWysiwygSelection={() => {
          const snap = saveMilkdownSelectionRange();
          return snap ? { text: snap.text } : null;
        }}
      />

      {mode === "source" ? (
        <textarea
          ref={sourceRef}
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onPaste={handleSourcePaste}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            const ta = e.currentTarget;
            const cursor = ta.selectionStart;
            const before = ta.value.slice(0, cursor);
            const hit = matchSlashToken(before);
            if (!hit) return;
            const exact = resolveExactSlashCommand(hit.query);
            const cmd = exact ?? filterSlashCommands(hit.query)[0] ?? null;
            if (!cmd) return;
            e.preventDefault();
            const applied = applySlashInSource(ta.value, cursor, cmd);
            if (!applied) return;
            if (cmd.id === "board") {
              const inserted = applied.next;
              const marker = "```kp-board\n";
              const fenceAt = inserted.lastIndexOf(marker, Math.max(0, applied.cursor));
              setBoardModal({
                writeBoard: (raw) => {
                  if (fenceAt < 0) {
                    rewriteContent(inserted, applied.cursor);
                    return;
                  }
                  const bodyStart = fenceAt + marker.length;
                  const bodyEnd = inserted.indexOf("\n```", bodyStart);
                  if (bodyEnd < 0) {
                    rewriteContent(inserted, applied.cursor);
                    return;
                  }
                  const next = inserted.slice(0, bodyStart) + raw + inserted.slice(bodyEnd);
                  rewriteContent(next, bodyStart + raw.length + "\n```\n".length);
                },
                removeBoard: () => {
                  if (fenceAt < 0) {
                    rewriteContent(inserted, applied.cursor);
                    return;
                  }
                  const end = inserted.indexOf("\n```", fenceAt);
                  const cutEnd = end >= 0 ? end + "\n```".length : applied.cursor;
                  const next =
                    inserted.slice(0, fenceAt) + inserted.slice(cutEnd).replace(/^\n/, "");
                  rewriteContent(next, fenceAt);
                },
              });
              rewriteContent(inserted, applied.cursor);
              return;
            }
            rewriteContent(applied.next, applied.cursor);
          }}
          onKeyUp={(e) => {
            // 仅在刚输入 @ 时唤起，避免每键重开面板
            if (e.key !== "@" && e.key !== "Process") return;
            const ta = e.currentTarget;
            const hit = detectEditorAgentAtTrigger(ta.value, ta.selectionStart);
            if (!hit) return;
            setAtTrigger((prev) => ({
              token: (prev?.token ?? 0) + 1,
              query: hit.query,
            }));
          }}
          placeholder={placeholder || "写 Markdown… /gs 公式 · /code 代码 · /hb 画板 · @ Agent"}
          spellCheck={false}
          className="min-h-[calc(100dvh-14rem)] flex-1 resize-none bg-transparent px-4 py-4 font-mono text-sm leading-relaxed text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)]"
        />
      ) : (
        <div className="min-h-[calc(100dvh-14rem)] flex-1">
          <MilkdownProvider key={`md-provider-${wysiwygEpoch}`}>
            <MilkdownWysiwyg
              key={`wysiwyg-${wysiwygEpoch}`}
              initialValue={draft}
              onChange={handleChange}
              placeholder={placeholder}
              boardHookRef={boardHookRef}
              linkNavGarden={docMeta?.garden}
              linkNavSlug={docMeta?.slug}
            />
          </MilkdownProvider>
        </div>
      )}

      <BoardEditorModal
        open={Boolean(boardModal)}
        initialRaw={boardModal?.initialRaw}
        onCancel={() => {
          // 仅新建未保存时取消删占位；重开编辑取消只关弹层
          if (boardModal?.isNew) boardModal.removeBoard();
          setBoardModal(null);
        }}
        onSave={(raw) => {
          boardModal?.writeBoard(raw);
          setBoardModal(null);
        }}
      />
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
      .milkdown-editor .milkdown img {
        max-width: 100%;
        height: auto;
        border-radius: 0.5rem;
        margin: 0.75rem 0;
      }
      .milkdown-editor .milkdown img[title^="kp-uploading:"] {
        opacity: 0.55;
        outline: 2px dashed var(--kp-brand);
        outline-offset: 2px;
        animation: kp-img-uploading 1.2s ease-in-out infinite;
      }
      @keyframes kp-img-uploading {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 0.75; }
      }
      .milkdown-editor .milkdown p {
        margin: 0.4rem 0;
        line-height: 1.7;
      }
      .milkdown-editor .milkdown li > p {
        margin: 0.15rem 0;
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
        padding: 0.05rem 0.3rem;
        border-radius: 0.25rem;
        font-size: 0.875em;
        line-height: 1.4;
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
        cursor: pointer;
      }
      .milkdown-editor .milkdown hr {
        border: none;
        border-top: 1px solid var(--kp-divider);
        margin: 1.5rem 0;
      }
      .milkdown-editor .milkdown table {
        width: 100%;
        border-collapse: collapse;
        margin: 1rem 0;
        font-size: 0.925rem;
      }
      .milkdown-editor .milkdown th,
      .milkdown-editor .milkdown td {
        border: 1px solid var(--kp-divider);
        padding: 0.5rem 0.75rem;
        text-align: left;
        vertical-align: top;
      }
      .milkdown-editor .milkdown th {
        background: var(--kp-bg-mute);
        font-weight: 600;
      }
      .milkdown-editor .milkdown tr:nth-child(even) td {
        background: color-mix(in oklab, var(--kp-bg-mute) 45%, transparent);
      }
      /* 公式：背景与页面一致（禁止 mute/灰底）；编辑时上方源码 + 下方实时预览 */
      .milkdown-editor .milkdown .kp-math-block,
      .milkdown-editor .milkdown .math-block,
      .milkdown-editor .milkdown div[data-type="math_block"] {
        cursor: pointer;
        margin: 0.85rem 0;
        padding: 0.15rem 0;
        border-radius: 0;
        background: transparent !important;
        background-color: transparent !important;
        overflow-x: auto;
        min-height: 1.5rem;
        box-shadow: none;
      }
      .milkdown-editor .milkdown .kp-math-block:hover:not(.is-editing) .kp-math-block-idle {
        background: transparent;
        box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--kp-divider) 80%, transparent);
        border-radius: 0.35rem;
      }
      .milkdown-editor .milkdown .kp-math-block-idle,
      .milkdown-editor .milkdown .kp-math-block-edit,
      .milkdown-editor .milkdown .kp-math-block-live,
      .milkdown-editor .milkdown .kp-math-block-source {
        background: transparent !important;
      }
      .milkdown-editor .milkdown .kp-math-block-idle {
        padding: 0.35rem 0.25rem;
      }
      .milkdown-editor .milkdown .kp-math-block[data-align="center"] .kp-math-block-idle,
      .milkdown-editor .milkdown .kp-math-block[data-align="center"] .kp-math-block-live {
        text-align: center;
      }
      .milkdown-editor .milkdown .kp-math-block[data-align="left"] .kp-math-block-idle,
      .milkdown-editor .milkdown .kp-math-block[data-align="left"] .kp-math-block-live {
        text-align: left;
      }
      .milkdown-editor .milkdown .kp-math-block[data-align="left"] .katex-display {
        text-align: left;
      }
      .milkdown-editor .milkdown .kp-math-block-toolbar {
        display: flex;
        justify-content: flex-end;
        gap: 0.2rem;
        margin-bottom: 0.15rem;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .milkdown-editor .milkdown .kp-math-block:hover .kp-math-block-toolbar,
      .milkdown-editor .milkdown .kp-math-block.is-editing .kp-math-block-toolbar {
        opacity: 1;
      }
      .milkdown-editor .milkdown .kp-math-align-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 0.3rem;
        background: transparent;
        color: var(--kp-text-3);
        cursor: pointer;
      }
      .milkdown-editor .milkdown .kp-math-align-btn:hover {
        color: var(--kp-text-1);
        background: color-mix(in oklab, var(--kp-text-1) 5%, transparent);
      }
      .milkdown-editor .milkdown .kp-math-align-btn[data-active="true"] {
        color: var(--kp-brand-deep, var(--kp-brand));
        border-color: color-mix(in oklab, var(--kp-brand) 35%, var(--kp-divider));
        background: color-mix(in oklab, var(--kp-brand) 8%, transparent);
      }
      .milkdown-editor .milkdown .kp-math-block-idle.is-empty {
        color: var(--kp-text-3);
        font-size: 0.875rem;
        text-align: left;
      }
      .milkdown-editor .milkdown .kp-math-block.is-editing {
        cursor: text;
        padding: 0.35rem 0 0.15rem;
        border-top: 1px solid color-mix(in oklab, var(--kp-divider) 55%, transparent);
        border-bottom: 1px solid color-mix(in oklab, var(--kp-divider) 55%, transparent);
        background: transparent !important;
      }
      .milkdown-editor .milkdown .kp-math-block-source {
        position: relative;
        overflow: hidden; /* 防 ghost 绝对定位溢出叠到下方 live 预览 */
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.875rem;
        line-height: 1.55;
      }
      .milkdown-editor .milkdown .kp-math-block-ghost {
        position: absolute;
        inset: 0;
        padding: 0.2rem 0.15rem;
        white-space: pre-wrap;
        word-break: break-word;
        overflow: hidden;
        pointer-events: none;
        color: transparent;
      }
      .milkdown-editor .milkdown .kp-math-ghost-typed {
        color: transparent;
      }
      .milkdown-editor .milkdown .kp-math-ghost-suffix {
        color: color-mix(in oklab, var(--kp-text-3) 75%, transparent);
      }
      .milkdown-editor .milkdown .kp-math-block-input {
        position: relative;
        z-index: 1;
        display: block;
        width: 100%;
        min-height: 1.75rem;
        resize: none;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: var(--kp-text-1);
        font: inherit;
        line-height: inherit;
        padding: 0.2rem 0.15rem;
        outline: none;
        caret-color: var(--kp-brand-deep, var(--kp-brand));
      }
      .milkdown-editor .milkdown .kp-math-block-hint {
        min-height: 1rem;
        margin-top: 0.1rem;
        font-size: 0.7rem;
        color: var(--kp-text-3);
        letter-spacing: 0.01em;
      }
      .milkdown-editor .milkdown .kp-math-block-live {
        margin-top: 0.35rem;
        padding: 0.45rem 0.25rem 0.2rem;
        border-top: 1px dashed color-mix(in oklab, var(--kp-divider) 80%, transparent);
        text-align: center;
        overflow-x: auto;
      }
      .milkdown-editor .milkdown .kp-math-block-live.is-empty {
        color: var(--kp-text-3);
        font-size: 0.8rem;
        text-align: left;
      }
      .milkdown-editor .milkdown .kp-math-block-live.is-suggestion {
        opacity: 0.55;
      }
      .milkdown-editor .milkdown .kp-math-inline {
        cursor: pointer;
        border-radius: 0.2rem;
        padding: 0 0.1rem;
      }
      .milkdown-editor .milkdown .kp-math-inline:hover:not(.is-editing) {
        background: transparent;
        box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--kp-divider) 70%, transparent);
      }
      .milkdown-editor .milkdown .kp-math-inline-idle.is-empty {
        color: var(--kp-text-3);
        font-size: 0.85em;
      }
      .milkdown-editor .milkdown .kp-math-inline-edit {
        display: inline-flex;
        align-items: baseline;
        gap: 0.35rem;
        max-width: 100%;
      }
      .milkdown-editor .milkdown .kp-math-inline-input {
        display: inline-block;
        min-width: 3.5rem;
        max-width: 14rem;
        border: 0;
        border-bottom: 1px solid color-mix(in oklab, var(--kp-divider) 90%, transparent);
        border-radius: 0;
        background: transparent;
        color: var(--kp-text-1);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.875rem;
        padding: 0 0.1rem;
        outline: none;
      }
      .milkdown-editor .milkdown .kp-math-inline-live {
        display: inline-block;
        padding: 0 0.15rem;
        color: var(--kp-text-2);
      }
      .milkdown-editor .milkdown .kp-math-inline-live.is-empty {
        display: none;
      }
      .milkdown-editor .milkdown .ProseMirror-selectednode.kp-math-inline,
      .milkdown-editor .milkdown .ProseMirror-selectednode.kp-math-block {
        outline: none;
      }
      .milkdown-editor .milkdown [data-placeholder]:empty::before {
        content: attr(data-placeholder);
        color: var(--kp-text-3);
        pointer-events: none;
      }
      /* 飞书式斜杠菜单 */
      .kp-editor-slash {
        position: absolute;
        z-index: 60;
        display: none;
        min-width: 16rem;
        max-width: 20rem;
        padding: 0.35rem;
        border-radius: 0.75rem;
        border: 1px solid var(--kp-divider);
        background: var(--kp-bg);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
      }
      .kp-editor-slash[data-show="true"] {
        display: block;
      }
      .kp-editor-slash-item {
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: 0.1rem 0.75rem;
        width: 100%;
        padding: 0.55rem 0.65rem;
        border: 0;
        border-radius: 0.5rem;
        background: transparent;
        text-align: left;
        cursor: pointer;
        color: var(--kp-text-1);
      }
      .kp-editor-slash-item[data-active="true"],
      .kp-editor-slash-item:hover {
        background: var(--kp-bg-mute);
      }
      .kp-editor-slash-title {
        grid-column: 1;
        font-size: 0.875rem;
        font-weight: 600;
      }
      .kp-editor-slash-alias {
        grid-column: 2;
        grid-row: 1 / span 2;
        align-self: center;
        font-size: 0.75rem;
        color: var(--kp-brand-deep);
        font-family: ui-monospace, monospace;
      }
      .kp-editor-slash-desc {
        grid-column: 1;
        font-size: 0.75rem;
        color: var(--kp-text-3);
      }
      .kp-editor-slash-empty {
        padding: 0.6rem 0.75rem;
        font-size: 0.8rem;
        color: var(--kp-text-3);
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById("kp-milkdown-styles")?.remove();
    };
  }, []);

  return null;
}
