"use client";

/**
 * 编辑器 @Agent 补全（Copilot 式）：选 Agent → 指令 → 预览 → Accept / Reject。
 * 不直接改文；Accept 后由父级把片段写入光标处。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AtSign, Bot, Check, Loader2, X } from "lucide-react";
import { DEFAULT_LLM_MODEL } from "@knowpilot/shared";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

export type EditorCompleteDocMeta = {
  title?: string;
  garden?: string;
  slug?: string;
};

export type EditorCompleteApplyPayload = {
  insertStart: number;
  insertEnd: number;
  content: string;
  /** true = 在 WYSIWYG 用 ProseMirror 替换冻结选区 */
  wysiwyg?: boolean;
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

interface EditorAgentCompleteProps {
  content: string;
  sourceTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  docMeta?: EditorCompleteDocMeta;
  onPreferSourceMode?: () => void;
  onApply: (payload: EditorCompleteApplyPayload) => void;
  /** 选中 Agent 后清掉源码里的 @xxx 前缀 */
  onRewriteContent?: (next: string, cursor?: number) => void;
  /** 外部 @ 触发：递增 token + 可选预填搜索词 */
  atTrigger?: { token: number; query: string } | null;
  /** 挂载命令式 API（选区工具条） */
  registerApi?: (api: EditorAgentCompleteApi | null) => void;
  className?: string;
}

export function detectEditorAgentAtTrigger(
  text: string,
  cursor: number,
): { query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/@([\w\u4e00-\u9fff-]*)$/);
  if (!m) return null;
  return { query: m[1] ?? "" };
}

export function EditorAgentComplete({
  content,
  sourceTextareaRef,
  docMeta,
  onPreferSourceMode,
  onApply,
  onRewriteContent,
  atTrigger,
  registerApi,
  className,
}: EditorAgentCompleteProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [agentQuery, setAgentQuery] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [selectedSnap, setSelectedSnap] = useState("");
  const [wysiwygRewrite, setWysiwygRewrite] = useState(false);

  const agentsQuery = trpc.agent.list.useQuery(
    { page: 1, pageSize: 100 },
    { staleTime: 60_000, enabled: phase !== "closed" },
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

  const captureRange = useCallback(() => {
    const ta = sourceTextareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? content.length;
      const end = ta.selectionEnd ?? start;
      setRange({ start, end });
      setSelectedSnap(start !== end ? content.slice(start, end) : "");
      return { start, end };
    }
    const end = content.length;
    setRange({ start: end, end });
    setSelectedSnap("");
    return { start: end, end };
  }, [content, sourceTextareaRef]);

  const openCompose = useCallback(
    (query = "") => {
      onPreferSourceMode?.();
      window.setTimeout(() => {
        captureRange();
        setWysiwygRewrite(false);
        setPhase("compose");
        setPickerOpen(true);
        setAgentQuery(query);
        setInstruction("");
        setPreview("");
        setError(null);
        setHighlightIdx(0);
      }, 0);
    },
    [captureRange, onPreferSourceMode],
  );

  const openForRewrite = useCallback(
    (opts: {
      instruction: string;
      selected: string;
      start?: number;
      end?: number;
      wysiwyg?: boolean;
    }) => {
      setSelectedSnap(opts.selected);
      setWysiwygRewrite(Boolean(opts.wysiwyg));
      setInstruction(opts.instruction);
      setPreview("");
      setError(null);
      setHighlightIdx(0);
      setPhase("compose");
      setPickerOpen(!agentId);

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
    [agentId, onPreferSourceMode, sourceTextareaRef],
  );

  useEffect(() => {
    if (!registerApi) return;
    registerApi({ openForRewrite });
    return () => registerApi(null);
  }, [registerApi, openForRewrite]);

  useEffect(() => {
    if (!atTrigger || atTrigger.token <= 0) return;
    openCompose(atTrigger.query);
    // 只响应 token，避免 openCompose 换引用时重复弹开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atTrigger?.token]);

  const close = useCallback(() => {
    setPhase("closed");
    setPickerOpen(false);
    setPreview("");
    setError(null);
    setInstruction("");
    setWysiwygRewrite(false);
  }, []);

  const selectAgent = (id: string, name: string) => {
    setAgentId(id);
    setAgentName(name);
    setPickerOpen(false);
    setAgentQuery("");
    const ta = sourceTextareaRef.current;
    const cur = ta?.selectionStart ?? content.length;
    const before = content.slice(0, cur);
    const after = content.slice(cur);
    const cleaned = before.replace(/@[\w\u4e00-\u9fff-]*$/, "");
    if (cleaned !== before) {
      onRewriteContent?.(cleaned + after, cleaned.length);
    }
  };

  const runComplete = () => {
    if (!agentId || !instruction.trim() || completeMut.isPending) return;

    let start = range.start;
    let end = range.end;
    let selected = selectedSnap || undefined;
    let before = "";
    let after = "";

    if (wysiwygRewrite) {
      selected = selectedSnap || undefined;
      const idx = selected ? content.indexOf(selected) : -1;
      if (idx >= 0 && selected) {
        before = content.slice(Math.max(0, idx - 800), idx);
        after = content.slice(idx + selected.length, idx + selected.length + 800);
      }
    } else {
      const captured = captureRange();
      start = captured.start;
      end = captured.end;
      before = content.slice(0, start);
      after = content.slice(end);
      selected = start !== end ? content.slice(start, end) : selectedSnap || undefined;
      setRange({ start, end });
    }

    if (!selected?.trim() && !instruction.trim()) return;

    setPhase("loading");
    setError(null);
    completeMut
      .mutateAsync({
        agentId,
        instruction: instruction.trim(),
        before,
        after,
        selected: selected || undefined,
        title: docMeta?.title,
        garden: docMeta?.garden,
        slug: docMeta?.slug,
        model: DEFAULT_LLM_MODEL,
      })
      .then((res) => {
        setPreview(res.content);
        if (!wysiwygRewrite) setRange({ start, end });
        setPhase("preview");
      })
      .catch((err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "补全失败";
        setError(msg);
        setPhase("compose");
      });
  };

  const accept = () => {
    if (!preview) return;
    onApply({
      insertStart: range.start,
      insertEnd: range.end,
      content: preview,
      wysiwyg: wysiwygRewrite,
    });
    close();
  };

  return (
    <div className={cn("relative", className)} data-testid="editor-agent-complete">
      <button
        type="button"
        onClick={() => openCompose("")}
        disabled={phase === "loading"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition",
          phase !== "closed"
            ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
            : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
        )}
        title="@ Agent 补全（默认 deepseek-v4-flash）"
        data-testid="editor-agent-complete-open"
      >
        <AtSign className="h-3.5 w-3.5" />
        Agent
      </button>

      {phase !== "closed" && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-[min(100vw-2rem,28rem)] rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 shadow-xl"
          data-testid="editor-agent-complete-panel"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--kp-text-1)]">@ Agent 补全</span>
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
            模型 {DEFAULT_LLM_MODEL} · Accept 写入光标/选区
            {selectedSnap ? " · 将替换选中段落" : " · 可生成公式 / 表格 / SVG·HTML 图"}
          </p>

          {selectedSnap && (
            <div className="mb-2 max-h-16 overflow-y-auto rounded-md border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]/40 px-2 py-1.5 text-[10px] text-[var(--kp-text-3)]">
              选区：{selectedSnap.slice(0, 160)}
              {selectedSnap.length > 160 ? "…" : ""}
            </div>
          )}

          {(phase === "compose" || phase === "loading") && agentId && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(selectedSnap
                ? ([
                    ["润色选中段落：更流畅、专业，保持原意，只输出改写后的正文。", "润色"],
                    ["精简选中段落：删冗余留要点，只输出改写后的正文。", "精简"],
                    ["扩写选中段落：补充解释与例子，只输出改写后的正文。", "扩写"],
                    ["把选中段落改得更易懂，面向初学者，只输出改写后的正文。", "易懂"],
                  ] as const)
                : ([
                    ["写一个相关公式", "公式"],
                    ["做一张对比表格", "表格"],
                    ["用 SVG 画一张示意图", "图表"],
                  ] as const)
              ).map(([text, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={phase === "loading"}
                  onClick={() => setInstruction(text)}
                  className="rounded-md border border-[var(--kp-divider)] px-2 py-0.5 text-[10px] text-[var(--kp-text-2)] hover:border-[var(--kp-brand)]/50 hover:text-[var(--kp-text-1)] disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {agentName && agentId ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--kp-brand-soft)]/70 px-2 py-1 text-xs text-[var(--kp-brand-deep)]">
                <Bot className="h-3 w-3" />
                {agentName}
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
                      idx === highlightIdx ? "bg-[var(--kp-brand-soft)]" : "hover:bg-[var(--kp-bg-mute)]",
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
                placeholder={
                  selectedSnap
                    ? "例：改成更正式的语气 · 加上一句过渡 · 纠正术语"
                    : "例：写 SFT 损失公式 · 做一张数据集对比表 · 用 SVG 画训练流程图"
                }
                disabled={phase === "loading" || !agentId}
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
                  disabled={!agentId || !instruction.trim() || phase === "loading"}
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
