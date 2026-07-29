"use client";

/**
 * 编辑器 AI 协写：
 * 1) 工具栏「润稿」— 内置指令（总结 / 整理格式…），默认 assistant + deepseek-v4-flash
 * 2) 正文键入 @agent — 选 Agent → 指令 → 预览 → Accept / Reject
 * 不直接改文；Accept 后由父级写回。默认带上当前段落作上下文。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Loader2, Sparkles, X } from "lucide-react";
import { DEFAULT_LLM_MODEL } from "@knowpilot/shared";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { extractEditorCompleteContext } from "@/lib/editorCompleteContext";
import {
  getMilkdownParagraphContext,
  saveMilkdownBlockRange,
  saveMilkdownSelectionRange,
} from "@/components/editor/milkdownSelectionApi";

export type EditorCompleteDocMeta = {
  title?: string;
  garden?: string;
  slug?: string;
  postId?: string;
  draftKey?: string;
};

export type EditorCompleteApplyPayload = {
  insertStart: number;
  insertEnd: number;
  content: string;
  /** true = 在 WYSIWYG 用 ProseMirror 替换冻结选区 */
  wysiwyg?: boolean;
  /** 整篇替换（整理格式） */
  replaceDocument?: boolean;
};

export type EditorAgentCompleteApi = {
  openForRewrite: (opts: {
    instruction: string;
    selected: string;
    start?: number;
    end?: number;
    wysiwyg?: boolean;
  }) => void;
};

type Phase = "closed" | "compose" | "loading" | "preview";
type ApplyMode = "cursor" | "selection" | "document";

type PolishPreset = {
  id: string;
  label: string;
  hint: string;
  instruction: string;
  applyMode: ApplyMode;
};

const POLISH_PRESETS: PolishPreset[] = [
  {
    id: "summarize",
    label: "总结这篇文章",
    hint: "生成摘要插入光标处",
    instruction:
      "总结这篇文章的核心论点、关键步骤与结论。用简洁 Markdown（可含短标题与要点列表），只输出摘要本身，不要寒暄。",
    applyMode: "cursor",
  },
  {
    id: "organize",
    label: "整理格式",
    hint: "补全占位、理顺全文结构",
    instruction:
      "这是一篇未完成草稿。请整理全文 Markdown：补全「这里应该是…」「TODO」「待补」「xxx」等占位；理顺段落与标题层级；统一列表/代码块/公式格式；保留作者意图与事实，不要杜撰关键数据。只输出整理后的完整正文，不要前言后语。",
    applyMode: "document",
  },
  {
    id: "polish-para",
    label: "润色当前段",
    hint: "围绕光标所在段落改写",
    instruction:
      "润色【当前段落】：更流畅、专业，保持原意与术语，只输出改写后的该段 Markdown（可含必要的相邻衔接句）。",
    applyMode: "selection",
  },
];

interface EditorAgentCompleteProps {
  content: string;
  sourceTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  docMeta?: EditorCompleteDocMeta;
  editorMode?: "wysiwyg" | "source";
  onPreferSourceMode?: () => void;
  onCaptureWysiwygSelection?: () => { text: string } | null;
  onApply: (payload: EditorCompleteApplyPayload) => void;
  onRewriteContent?: (next: string, cursor?: number) => void;
  /** 外部 @agent 触发：递增 token + 可选预填搜索词；mode 决定是否切源码 */
  atTrigger?: { token: number; query: string; mode?: "wysiwyg" | "source" } | null;
  registerApi?: (api: EditorAgentCompleteApi | null) => void;
  className?: string;
}

export { detectEditorAgentAtTrigger } from "@/lib/editorCompleteContext";

export function EditorAgentComplete({
  content,
  sourceTextareaRef,
  docMeta,
  editorMode = "wysiwyg",
  onPreferSourceMode,
  onCaptureWysiwygSelection,
  onApply,
  onRewriteContent,
  atTrigger,
  registerApi,
  className,
}: EditorAgentCompleteProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [useDefaultAgent, setUseDefaultAgent] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [selectedSnap, setSelectedSnap] = useState("");
  const [paragraphSnap, setParagraphSnap] = useState("");
  const [wysiwygRewrite, setWysiwygRewrite] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyMode>("cursor");
  const [panelTitle, setPanelTitle] = useState("Agent 协写");

  const agentsQuery = trpc.agent.list.useQuery(
    { page: 1, pageSize: 100 },
    { staleTime: 60_000, enabled: phase !== "closed" || menuOpen },
  );
  const completeMut = trpc.agent.editorComplete.useMutation();

  const agents = useMemo(() => {
    const items = agentsQuery.data?.items ?? [];
    const q = agentQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q) ||
        a.tier.toLowerCase().includes(q),
    );
  }, [agentsQuery.data?.items, agentQuery]);

  const captureSourceContext = useCallback(() => {
    const ta = sourceTextareaRef.current;
    const start = ta?.selectionStart ?? content.length;
    const end = ta?.selectionEnd ?? start;
    return extractEditorCompleteContext(content, start, end);
  }, [content, sourceTextareaRef]);

  const captureWysiwygContext = useCallback(() => {
    const md = getMilkdownParagraphContext();
    if (md) {
      return {
        paragraph: md.paragraph,
        before: md.before.slice(-1200),
        after: md.after.slice(0, 1200),
        selected: md.selected,
        start: -1,
        end: -1,
      };
    }
    const snap = onCaptureWysiwygSelection?.();
    if (snap?.text?.trim()) {
      const idx = content.indexOf(snap.text);
      if (idx >= 0) {
        return extractEditorCompleteContext(content, idx, idx + snap.text.length);
      }
    }
    return extractEditorCompleteContext(content, content.length, content.length);
  }, [content, onCaptureWysiwygSelection]);

  const openCompose = useCallback(
    (query = "", opts?: { forceSource?: boolean; title?: string }) => {
      const useSource = opts?.forceSource || editorMode === "source";
      setPanelTitle(opts?.title ?? "@agent 协写");
      setApplyMode("cursor");
      setUseDefaultAgent(false);
      setMenuOpen(false);

      if (useSource) {
        if (editorMode !== "source") onPreferSourceMode?.();
        window.setTimeout(() => {
          const ctx = captureSourceContext();
          // 清掉已键入的 @agent…
          const ta = sourceTextareaRef.current;
          if (ta && onRewriteContent) {
            const cur = ta.selectionStart;
            const before = content.slice(0, cur);
            const after = content.slice(cur);
            const cleaned = before.replace(/@agent[\w\u4e00-\u9fff-]*$/i, "");
            if (cleaned !== before) {
              onRewriteContent(cleaned + after, cleaned.length);
              const ctx2 = extractEditorCompleteContext(cleaned + after, cleaned.length, cleaned.length);
              setRange({ start: ctx2.start, end: ctx2.end });
              setSelectedSnap(ctx2.selected ?? "");
              setParagraphSnap(ctx2.paragraph);
            } else {
              setRange({ start: ctx.start, end: ctx.end });
              setSelectedSnap(ctx.selected ?? "");
              setParagraphSnap(ctx.paragraph);
            }
          } else {
            setRange({ start: ctx.start, end: ctx.end });
            setSelectedSnap(ctx.selected ?? "");
            setParagraphSnap(ctx.paragraph);
          }
          setWysiwygRewrite(false);
          setPhase("compose");
          setPickerOpen(true);
          setAgentQuery(query);
          setInstruction("");
          setPreview("");
          setError(null);
          setHighlightIdx(0);
        }, 0);
        return;
      }

      const snap = onCaptureWysiwygSelection?.();
      const ctx = captureWysiwygContext();
      setSelectedSnap(snap?.text?.trim() ? snap.text : ctx.selected ?? "");
      setParagraphSnap(ctx.paragraph);
      setWysiwygRewrite(true);
      setRange({ start: -1, end: -1 });
      setPhase("compose");
      setPickerOpen(true);
      setAgentQuery(query);
      setInstruction("");
      setPreview("");
      setError(null);
      setHighlightIdx(0);
    },
    [
      captureSourceContext,
      captureWysiwygContext,
      content,
      editorMode,
      onCaptureWysiwygSelection,
      onPreferSourceMode,
      onRewriteContent,
      sourceTextareaRef,
    ],
  );

  const openPolishPreset = useCallback(
    (preset: PolishPreset) => {
      setMenuOpen(false);
      setPanelTitle(`润稿 · ${preset.label}`);
      setApplyMode(preset.applyMode);
      setInstruction(preset.instruction);
      setPreview("");
      setError(null);
      setPickerOpen(false);
      setUseDefaultAgent(true);

      const inSource = editorMode === "source";
      if (inSource) {
        const ctx = captureSourceContext();
        if (preset.applyMode === "document") {
          setRange({ start: 0, end: content.length });
          setSelectedSnap(content);
          setParagraphSnap(ctx.paragraph);
          setWysiwygRewrite(false);
        } else if (preset.applyMode === "selection" && ctx.paragraph) {
          const pStart = content.indexOf(ctx.paragraph);
          const start = pStart >= 0 ? pStart : ctx.start;
          const end = pStart >= 0 ? pStart + ctx.paragraph.length : ctx.end;
          setRange({ start, end });
          setSelectedSnap(ctx.paragraph);
          setParagraphSnap(ctx.paragraph);
          setWysiwygRewrite(false);
        } else {
          setRange({ start: ctx.start, end: ctx.end });
          setSelectedSnap(ctx.selected ?? "");
          setParagraphSnap(ctx.paragraph);
          setWysiwygRewrite(false);
        }
      } else {
        if (preset.applyMode === "selection") {
          saveMilkdownBlockRange();
        } else {
          saveMilkdownSelectionRange();
          onCaptureWysiwygSelection?.();
        }
        const ctx = captureWysiwygContext();
        setParagraphSnap(ctx.paragraph);
        if (preset.applyMode === "document") {
          setSelectedSnap(content);
          setWysiwygRewrite(false);
          setRange({ start: 0, end: content.length });
        } else if (preset.applyMode === "selection") {
          setSelectedSnap(ctx.paragraph || ctx.selected || "");
          setWysiwygRewrite(true);
          setRange({ start: -1, end: -1 });
        } else {
          setSelectedSnap(ctx.selected ?? "");
          setWysiwygRewrite(true);
          setRange({ start: -1, end: -1 });
        }
      }

      // 润稿走服务端默认 assistant（可不传 agentId）
      setAgentId(null);
      setAgentName("assistant");
      setUseDefaultAgent(true);
      setPhase("compose");
    },
    [
      captureSourceContext,
      captureWysiwygContext,
      content,
      editorMode,
      onCaptureWysiwygSelection,
    ],
  );

  const openForRewrite = useCallback(
    (opts: {
      instruction: string;
      selected: string;
      start?: number;
      end?: number;
      wysiwyg?: boolean;
    }) => {
      setPanelTitle("选区改写");
      setSelectedSnap(opts.selected);
      setParagraphSnap(opts.selected);
      setWysiwygRewrite(Boolean(opts.wysiwyg));
      setInstruction(opts.instruction);
      setPreview("");
      setError(null);
      setHighlightIdx(0);
      setPhase("compose");
      setApplyMode("selection");
      setPickerOpen(!agentId && !useDefaultAgent);
      setMenuOpen(false);

      if (opts.wysiwyg) {
        setRange({ start: -1, end: -1 });
        return;
      }

      onPreferSourceMode?.();
      const start = opts.start ?? 0;
      const end = opts.end ?? start;
      setRange({ start, end });
      window.setTimeout(() => {
        const ta = sourceTextareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(start, end);
      }, 0);
    },
    [agentId, onPreferSourceMode, sourceTextareaRef, useDefaultAgent],
  );

  useEffect(() => {
    if (!registerApi) return;
    registerApi({ openForRewrite });
    return () => registerApi(null);
  }, [registerApi, openForRewrite]);

  useEffect(() => {
    if (!atTrigger || atTrigger.token <= 0) return;
    const forceSource = atTrigger.mode === "source";
    const t = window.setTimeout(() => {
      openCompose(atTrigger.query, {
        forceSource,
        title: "@agent 协写",
      });
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atTrigger?.token]);

  const close = useCallback(() => {
    setPhase("closed");
    setMenuOpen(false);
    setPickerOpen(false);
    setPreview("");
    setError(null);
    setInstruction("");
    setWysiwygRewrite(false);
    setUseDefaultAgent(false);
  }, []);

  const selectAgent = (id: string, name: string) => {
    setAgentId(id);
    setAgentName(name);
    setUseDefaultAgent(false);
    setPickerOpen(false);
    setAgentQuery("");
  };

  const runComplete = () => {
    if ((!agentId && !useDefaultAgent) || !instruction.trim() || completeMut.isPending) return;

    let start = range.start;
    let end = range.end;
    let selected = selectedSnap || undefined;
    let before = "";
    let after = "";
    let paragraph = paragraphSnap;

    if (applyMode === "document") {
      before = "";
      after = "";
      selected = content;
      paragraph = paragraphSnap || content.slice(0, 400);
      start = 0;
      end = content.length;
    } else if (wysiwygRewrite) {
      selected = selectedSnap || undefined;
      const ctx = extractEditorCompleteContext(
        content,
        selected ? Math.max(0, content.indexOf(selected)) : content.length,
        selected && content.indexOf(selected) >= 0
          ? content.indexOf(selected) + selected.length
          : content.length,
      );
      before = ctx.before;
      after = ctx.after;
      paragraph = paragraphSnap || ctx.paragraph;
      if (!selected && applyMode === "selection" && paragraph) {
        selected = paragraph;
      }
    } else {
      const ctx = extractEditorCompleteContext(content, start, end);
      before = ctx.before;
      after = ctx.after;
      paragraph = paragraphSnap || ctx.paragraph;
      selected = start !== end ? content.slice(start, end) : selectedSnap || undefined;
      if (applyMode === "selection" && !selected?.trim() && paragraph) {
        selected = paragraph;
        const pAt = content.indexOf(paragraph);
        if (pAt >= 0) {
          start = pAt;
          end = pAt + paragraph.length;
        }
      }
      setRange({ start, end });
    }

    setPhase("loading");
    setError(null);
    completeMut
      .mutateAsync({
        ...(agentId ? { agentId } : {}),
        instruction: instruction.trim(),
        before,
        after,
        paragraph: paragraph || undefined,
        selected: selected || undefined,
        title: docMeta?.title,
        garden: docMeta?.garden,
        slug: docMeta?.slug,
        model: DEFAULT_LLM_MODEL,
      })
      .then((res) => {
        setPreview(res.content);
        if (res.agentName) setAgentName(res.agentName);
        if (res.agentId) setAgentId(res.agentId);
        if (!wysiwygRewrite) setRange({ start, end });
        setPhase("preview");
      })
      .catch((err: unknown) => {
        const msg =
          err &&
          typeof err === "object" &&
          "message" in err &&
          typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "补全失败";
        setError(msg);
        setPhase("compose");
      });
  };

  const accept = () => {
    if (!preview) return;
    if (applyMode === "document") {
      onApply({
        insertStart: 0,
        insertEnd: content.length,
        content: preview,
        replaceDocument: true,
      });
      close();
      return;
    }
    onApply({
      insertStart: range.start,
      insertEnd: range.end,
      content: preview,
      wysiwyg: wysiwygRewrite,
    });
    close();
  };

  const canRun = Boolean((agentId || useDefaultAgent) && instruction.trim());

  return (
    <div className={cn("relative", className)} data-testid="editor-agent-complete">
      <button
        type="button"
        onClick={() => {
          if (phase !== "closed") {
            close();
            return;
          }
          setMenuOpen((v) => !v);
        }}
        disabled={phase === "loading"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition",
          phase !== "closed" || menuOpen
            ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
            : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
        )}
        title="润稿：总结 / 整理格式 / 润色当前段；正文键入 @agent 可唤起 Agent 协写"
        data-testid="editor-polish-open"
      >
        <Sparkles className="h-3.5 w-3.5" />
        润稿
      </button>

      {menuOpen && phase === "closed" && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1 shadow-xl"
          data-testid="editor-polish-menu"
        >
          <p className="px-3 py-1.5 text-[10px] text-[var(--kp-text-3)]">
            默认 {DEFAULT_LLM_MODEL} · 预览后接受
          </p>
          {POLISH_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openPolishPreset(p)}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--kp-bg-mute)]"
            >
              <span className="text-xs font-medium text-[var(--kp-text-1)]">{p.label}</span>
              <span className="text-[10px] text-[var(--kp-text-3)]">{p.hint}</span>
            </button>
          ))}
          <div className="my-1 border-t border-[var(--kp-divider)]" />
          <button
            type="button"
            onClick={() => openCompose("", { title: "@agent 协写" })}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
          >
            <Bot className="h-3.5 w-3.5" />
            自定义 @agent…
          </button>
          <p className="px-3 py-1.5 text-[10px] leading-snug text-[var(--kp-text-3)]">
            也可在正文直接键入 <code className="text-[var(--kp-text-2)]">@agent</code>
          </p>
        </div>
      )}

      {phase !== "closed" && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-[min(100vw-2rem,28rem)] rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 shadow-xl"
          data-testid="editor-agent-complete-panel"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--kp-text-1)]">{panelTitle}</span>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              aria-label="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="mb-2 text-[10px] text-[var(--kp-text-3)]">
            模型 {DEFAULT_LLM_MODEL}
            {applyMode === "document"
              ? " · 接受后替换全文"
              : selectedSnap
                ? " · 接受后替换选区/段落"
                : " · 接受后插入光标处"}
          </p>

          {paragraphSnap && (
            <div className="mb-2 max-h-14 overflow-y-auto rounded-md border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]/40 px-2 py-1.5 text-[10px] text-[var(--kp-text-3)]">
              当前段：{paragraphSnap.slice(0, 120)}
              {paragraphSnap.length > 120 ? "…" : ""}
            </div>
          )}

          {agentName || useDefaultAgent ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--kp-brand-soft)]/70 px-2 py-1 text-xs text-[var(--kp-brand-deep)]">
                <Bot className="h-3 w-3" />
                {agentName ?? "assistant"}
              </span>
              <button
                type="button"
                className="text-[10px] text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
                onClick={() => {
                  setPickerOpen(true);
                  setAgentQuery("");
                }}
              >
                更换
              </button>
            </div>
          ) : (
            <p className="mb-2 text-xs text-[var(--kp-text-3)]">先选择一个 Agent</p>
          )}

          {pickerOpen && (
            <div
              className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-[var(--kp-divider)]"
              data-testid="editor-agent-picker"
            >
              <input
                autoFocus
                value={agentQuery}
                onChange={(e) => {
                  setAgentQuery(e.target.value);
                  setHighlightIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.min(i + 1, Math.max(agents.length - 1, 0)));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && agents[highlightIdx]) {
                    e.preventDefault();
                    const a = agents[highlightIdx]!;
                    selectAgent(a.id, a.name);
                  } else if (e.key === "Escape") {
                    setPickerOpen(false);
                  }
                }}
                placeholder="搜索 Agent…"
                className="w-full border-b border-[var(--kp-divider)] bg-transparent px-2.5 py-1.5 text-xs outline-none"
              />
              {agentsQuery.isLoading ? (
                <div className="px-2.5 py-2 text-xs text-[var(--kp-text-3)]">加载中…</div>
              ) : agents.length === 0 ? (
                <div className="px-2.5 py-2 text-xs text-[var(--kp-text-3)]">无匹配 Agent</div>
              ) : (
                agents.map((a, idx) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => selectAgent(a.id, a.name)}
                    className={cn(
                      "flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs",
                      idx === highlightIdx
                        ? "bg-[var(--kp-brand-soft)]"
                        : "hover:bg-[var(--kp-bg-mute)]",
                    )}
                  >
                    <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--kp-text-1)]">{a.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[var(--kp-text-3)]">
                        {a.tier}
                        {a.description ? ` · ${a.description}` : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {(phase === "compose" || phase === "loading") && (
            <>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="告诉 Agent 要在光标处写什么 / 怎么改…"
                disabled={phase === "loading" || (!agentId && !useDefaultAgent)}
                className="mb-2 w-full resize-none rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]/40 px-2.5 py-2 text-xs text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)] disabled:opacity-50"
                data-testid="editor-agent-instruction"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    runComplete();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--kp-text-3)]">Ctrl/Cmd+Enter 生成</span>
                <button
                  type="button"
                  onClick={runComplete}
                  disabled={!canRun || phase === "loading"}
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--kp-brand-deep)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  data-testid="editor-agent-run"
                >
                  {phase === "loading" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      生成中…
                    </>
                  ) : (
                    "生成"
                  )}
                </button>
              </div>
            </>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-600" data-testid="editor-agent-error">
              {error}
            </p>
          )}

          {phase === "preview" && (
            <div className="mt-1 space-y-2" data-testid="editor-agent-preview">
              <div className="max-h-48 overflow-y-auto rounded-lg border border-dashed border-[var(--kp-brand)]/40 bg-[var(--kp-brand-soft)]/20 px-2.5 py-2">
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--kp-text-1)]">
                  {preview}
                </pre>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPreview("");
                    setPhase("compose");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--kp-divider)] px-3 py-1.5 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                  data-testid="editor-agent-reject"
                >
                  <X className="h-3.5 w-3.5" />
                  拒绝
                </button>
                <button
                  type="button"
                  onClick={accept}
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--kp-brand-deep)] px-3 py-1.5 text-xs font-medium text-white"
                  data-testid="editor-agent-accept"
                >
                  <Check className="h-3.5 w-3.5" />
                  接受
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
