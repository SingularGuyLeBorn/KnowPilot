"use client";

import { memo, useEffect, useRef, useState, useCallback } from "react";
import { Bot, Loader2, Plus, Send, Square, X } from "lucide-react";
import type { ChatSessionConfig, Skill } from "@knowpilot/shared";
import { LucideIconByName, ChatShortcutHints, ShortcutSlashSkill } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import type { ChatQueueAttachment } from "@/lib/chatQueueTypes";
import { ChatModelMenu } from "@/components/chatModelMenu";
import { ChatInputChips } from "@/components/chatInputChips";

export interface SelectedSkill {
  id: string;
  name: string;
  icon?: string | null;
  description: string;
  code: string;
}

interface ChatInputAreaProps {
  onSend: (
    text: string,
    skill?: SelectedSkill,
    attachments?: ChatQueueAttachment[],
    delivery?: "steer" | "follow_up",
  ) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  queueLength?: number;
  skills: Skill[];
  selectedSkill: SelectedSkill | null;
  onSkillChange: (skill: SelectedSkill | null) => void;
  modelHint?: string;
  modelId?: string;
  supportsVision?: boolean;
  chatConfig: ChatSessionConfig;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  resetPromptToAgent: () => void;
  onOpenPromptEditor: () => void;
  modelSupportsReasoning: boolean;
  modelReasoningRequired: boolean;
  /** 会话级提示（如子代理任务会话警告），显示在输入框上方 */
  sessionHint?: string;
  /** 当前会话 ID，用于隔离上键历史恢复 */
  sessionId?: string | null;
}

// R16：memo 化——onSend(onStop)已 useCallback、skills 已 useMemo 稳定，流式期间 props 稳定可跳过重渲染
export const ChatInputArea = memo(function ChatInputArea({
  onSend,
  onStop,
  disabled,
  isStreaming,
  queueLength = 0,
  skills,
  selectedSkill,
  onSkillChange,
  modelHint,
  modelId = "",
  supportsVision = false,
  chatConfig,
  updateConfig,
  resetPromptToAgent,
  onOpenPromptEditor,
  modelSupportsReasoning,
  modelReasoningRequired,
  sessionHint,
  sessionId,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 发送防重入锁：ref 在同步阶段立即生效，避免 React state 批处理导致双击/双快捷键穿透
  const sendLockRef = useRef(false);
  const pendingDeliveryRef = useRef<"steer" | "follow_up" | undefined>(undefined);

  // UX #6：进入 / 切换会话后自动聚焦输入框，从 Agent 卡片「对话」直达可立即打字。
  // key={sessionId} 使切会话时组件重挂载，此 effect 每次挂载执行一次。
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 输入框 value 内部自管理，避免每个字符都触发外层 ChatView 重渲染
  const [input, setInput] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);

  const openSkillPicker = useCallback(() => {
    textareaRef.current?.focus();
    setSkillQuery("");
    setSkillOpen(true);
    setHighlightIdx(0);
  }, []);

  const focusQueuePanel = useCallback(() => {
    document
      .querySelector<HTMLElement>("[data-testid='chat-queue-panel']")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);
  const [pendingImages, setPendingImages] = useState<ChatQueueAttachment[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  // 发送按钮防抖/防重入：用 ref 锁 + state 同步禁用按钮，避免 React state 批处理导致双击/双快捷键穿透
  const [isSending, setIsSending] = useState(false);

  // 上键历史恢复：按 sessionId 隔离，存 localStorage
  const historyKey = sessionId ? `kp-input-history:${sessionId}` : null;
  const [historyIdx, setHistoryIdx] = useState(-1); // -1 = 不在浏览历史模式
  const [draftBackup, setDraftBackup] = useState(""); // 浏览历史前的草稿备份

  const getHistory = useCallback((): string[] => {
    if (!historyKey) return [];
    try {
      const raw = localStorage.getItem(historyKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }, [historyKey]);

  const pushHistory = useCallback(
    (text: string) => {
      if (!historyKey || !text.trim()) return;
      try {
        const list = getHistory();
        // 避免连续重复
        if (list[0] !== text) {
          list.unshift(text);
          if (list.length > 50) list.length = 50; // 上限 50 条
          localStorage.setItem(historyKey, JSON.stringify(list));
        }
      } catch {
        // ignore
      }
    },
    [historyKey, getHistory],
  );

  const ocrMutation = trpc.agent.ocrImage.useMutation();

  const enabledSkills = skills.filter((s) => s.enabled);

  const filteredSkills = enabledSkills.filter((s) => {
    const q = skillQuery.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  });

  const detectSkillTrigger = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(/\/([\w-]*)$/);
    if (match) {
      setSkillQuery(match[1] ?? "");
      setSkillOpen(true);
      setHighlightIdx(0);
    } else {
      setSkillOpen(false);
      setSkillQuery("");
    }
  };

  const activeHighlightIdx =
    skillOpen && filteredSkills.length > 0
      ? Math.min(highlightIdx, filteredSkills.length - 1)
      : 0;

  const selectSkill = (skill: Skill) => {
    onSkillChange({
      id: skill.id,
      name: skill.name,
      icon: skill.icon,
      description: skill.description,
      code: skill.code,
    });
    const ta = textareaRef.current;
    if (ta) {
      const before = input.slice(0, ta.selectionStart);
      const after = input.slice(ta.selectionStart);
      const cleaned = before.replace(/\/[\w-]*$/, "");
      setInput(cleaned + after);
    } else {
      setInput(input.replace(/\/[\w-]*$/, ""));
    }
    setSkillOpen(false);
    textareaRef.current?.focus();
  };

  const runOcrForAttachment = async (att: ChatQueueAttachment): Promise<ChatQueueAttachment> => {
    if (att.extractedText || supportsVision) return att;
    const base64 = att.previewUrl?.split(",")[1] ?? "";
    if (!base64) return att;
    const res = await ocrMutation.mutateAsync({
      base64,
      mimeType: att.mimeType,
    });
    if (!res.success || !res.data?.text?.trim()) {
      const msg =
        (res as { error?: { message?: string } }).error?.message ??
        "OCR 未返回文字，请检查 pnpm ocr:check 或配置 OCR_SPACE_API_KEY";
      throw new Error(msg);
    }
    return {
      ...att,
      extractedText: res.data.text,
      source: res.data.source ?? "ocr",
    };
  };

  const releaseSendLock = () => {
    sendLockRef.current = false;
    setIsSending(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || disabled || ocrLoading || sendLockRef.current) return;
    sendLockRef.current = true;
    setIsSending(true);

    let attachments = pendingImages;
    const needsOcr = !supportsVision && attachments.some((a) => !a.extractedText);
    if (needsOcr) {
      setOcrLoading(true);
      setOcrError(null);
      try {
        attachments = await Promise.all(attachments.map(runOcrForAttachment));
      } catch (err: unknown) {
        setOcrError(err instanceof Error ? err.message : "OCR 识别失败");
        releaseSendLock();
        return;
      } finally {
        setOcrLoading(false);
      }
    }

    onSend(
      text,
      selectedSkill ?? undefined,
      attachments.length ? attachments : undefined,
      // Alt+Ctrl/Cmd+Enter → follow_up；普通 Ctrl/Cmd+Enter → 由 Chat 决定（idle=队列 / streaming=steer）
      pendingDeliveryRef.current,
    );
    pendingDeliveryRef.current = undefined;
    setInput(""); // 清空输入框（状态内部化后由组件自行清空）
    pushHistory(text); // 记录到上键历史
    onSkillChange(null);
    setPendingImages([]);
    setOcrError(null);
    setHistoryIdx(-1); // 退出历史浏览模式
    // 同步释放 ref 锁；isSending 继续保留 300ms，让按钮保持禁用，防止连击/快捷键穿透。
    sendLockRef.current = false;
    setTimeout(releaseSendLock, 300);
  };

  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const previewUrl = reader.result as string;
      const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const att: ChatQueueAttachment = {
        id,
        name: file.name,
        mimeType: file.type,
        previewUrl,
        source: supportsVision ? "vision" : "ocr",
      };
      setOcrError(null);
      setPendingImages((prev) => [...prev, att]);

      if (!supportsVision) {
        setOcrLoading(true);
        void runOcrForAttachment(att)
          .then((done) => {
            setPendingImages((prev) => prev.map((x) => (x.id === id ? done : x)));
          })
          .catch((err: unknown) => {
            setOcrError(err instanceof Error ? err.message : "OCR 识别失败");
            setPendingImages((prev) => prev.filter((x) => x.id !== id));
          })
          .finally(() => {
            setOcrLoading(false);
          });
      }
    };
    reader.readAsDataURL(file);
  };

  const canSend = (!!input.trim() || pendingImages.length > 0) && !disabled && !ocrLoading && !isSending;
  const placeholderHint = disabled
    ? "后端未连接"
    : isStreaming
      ? "Agent 回复中，发送将加入队列…"
      : queueLength > 0
        ? `队列中还有 ${queueLength} 条，继续发送会依次执行`
        : "输入消息";

  return (
    <div className="relative mx-auto max-w-3xl">
      {sessionHint && (
        <div
          data-testid="session-hint"
          className="mb-2 flex items-center gap-1.5 rounded-lg border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/40 px-3 py-1.5 text-[11px] text-[var(--kp-brand-deep)]"
        >
          <Bot className="h-3 w-3 shrink-0" />
          <span>{sessionHint}</span>
        </div>
      )}
      {selectedSkill && (
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-2.5 py-1 text-xs font-medium text-[var(--kp-brand-deep)]">
            <LucideIconByName name={selectedSkill.icon} className="h-3 w-3" />
            {selectedSkill.name}
          </span>
          <button
            type="button"
            onClick={() => onSkillChange(null)}
            className="rounded p-0.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-[var(--kp-text-3)]">发送时将覆盖 System Prompt</span>
        </div>
      )}

      {skillOpen && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-2 max-h-48 w-full overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] py-1 shadow-lg">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--kp-text-3)]">
            选择 Skill
            <ShortcutSlashSkill />
          </div>
          {filteredSkills.map((skill, i) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => selectSkill(skill)}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                i === activeHighlightIdx ? "bg-[var(--kp-brand-soft)]" : "hover:bg-[var(--kp-bg-mute)]",
              )}
            >
              <LucideIconByName name={skill.icon} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
              <div className="min-w-0">
                <div className="font-medium text-[var(--kp-text-1)]">{skill.name}</div>
                <div className="truncate text-xs text-[var(--kp-text-3)]">{skill.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-sm transition-[border-color,box-shadow]",
          "focus-within:border-[var(--kp-brand)] focus-within:shadow-[0_0_0_3px_rgba(184,160,144,0.12)]",
          disabled && "opacity-60",
        )}
      >
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              detectSkillTrigger(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) => detectSkillTrigger(input, e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (skillOpen && filteredSkills.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.min(i + 1, filteredSkills.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  selectSkill(filteredSkills[activeHighlightIdx]);
                  return;
                }
                if (e.key === "Escape") {
                  setSkillOpen(false);
                  return;
                }
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                // Alt+Ctrl/Cmd+Enter = follow_up；普通 Ctrl/Cmd+Enter = 默认（streaming 时为 steer）
                pendingDeliveryRef.current = e.altKey ? "follow_up" : undefined;
                handleSend();
              }
              // 上键恢复历史消息（skill picker 关闭时）
              if (!skillOpen && e.key === "ArrowUp" && textareaRef.current?.selectionStart === 0) {
                const list = getHistory();
                if (list.length === 0) return;
                e.preventDefault();
                if (historyIdx === -1) {
                  // 首次按上键：备份当前草稿，显示最新一条历史
                  setDraftBackup(input);
                  setHistoryIdx(0);
                  setInput(list[0]);
                } else if (historyIdx < list.length - 1) {
                  setHistoryIdx(historyIdx + 1);
                  setInput(list[historyIdx + 1]);
                }
              }
              if (!skillOpen && e.key === "ArrowDown" && historyIdx !== -1) {
                e.preventDefault();
                const list = getHistory();
                if (historyIdx > 0) {
                  setHistoryIdx(historyIdx - 1);
                  setInput(list[historyIdx - 1]);
                } else {
                  // 回到草稿
                  setHistoryIdx(-1);
                  setInput(draftBackup);
                }
              }
            }}
            onPaste={(e) => {
              const item = e.clipboardData?.items?.[0];
              if (item?.kind === "file" && item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) addImageFile(file);
              }
            }}
            rows={3}
            disabled={disabled}
            placeholder=""
            data-testid="chat-input"
            className="min-h-[88px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-[var(--kp-text-1)] caret-[var(--kp-text-1)] outline-none disabled:cursor-not-allowed"
          />
          {!disabled && !input.trim() && (
            <div
              className="pointer-events-none absolute inset-0 flex items-start justify-between gap-3 px-4 py-3"
              aria-hidden={false}
            >
              <span className="text-sm text-[var(--kp-text-3)]">{placeholderHint}</span>
              <ChatShortcutHints isStreaming={isStreaming} className="pointer-events-auto shrink-0" />
            </div>
          )}
        </div>

        {ocrError && (
          <div
            data-testid="chat-ocr-error"
            className="border-t border-[var(--kp-divider-light)] px-4 py-2 text-xs text-red-600"
          >
            {ocrError}
          </div>
        )}

        {pendingImages.length > 0 && (
          <div
            data-testid="chat-image-previews"
            className="flex flex-wrap gap-2 border-t border-[var(--kp-divider-light)] px-4 py-2"
          >
            {pendingImages.map((img) => (
              <div key={img.id} className="relative" data-testid="chat-image-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt={img.name} className="h-14 w-14 rounded-lg object-cover" />
                {!supportsVision && img.extractedText && (
                  <span
                    data-testid="chat-ocr-ready"
                    className="absolute bottom-0 left-0 right-0 truncate rounded-b-lg bg-emerald-600/80 px-1 text-[9px] text-white"
                    title={img.extractedText.slice(0, 200)}
                  >
                    OCR ✓
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPendingImages((p) => p.filter((x) => x.id !== img.id))}
                  className="absolute -right-1 -top-1 rounded-full bg-black/60 p-0.5 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 底部功能栏：附件 | 模型菜单 | 发送 */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--kp-divider-light)] px-3 py-2">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="chat-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addImageFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={disabled || ocrLoading}
              onClick={() => fileRef.current?.click()}
              data-testid="chat-attach-image"
              className="inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand-deep)] disabled:opacity-50"
              title="添加图片"
              aria-label="添加图片"
            >
              {ocrLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" data-testid="chat-ocr-loading" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <ChatModelMenu
              chatConfig={chatConfig}
              updateConfig={updateConfig}
              resetPromptToAgent={resetPromptToAgent}
              onOpenPromptEditor={onOpenPromptEditor}
              modelSupportsReasoning={modelSupportsReasoning}
              modelReasoningRequired={modelReasoningRequired}
            />
            <button
              type="button"
              onClick={isStreaming ? onStop : handleSend}
              disabled={!canSend && !isStreaming}
              data-testid={isStreaming ? "chat-stop" : "chat-send"}
              title={isStreaming ? "停止生成" : queueLength > 0 ? "加入发送队列" : "发送"}
              aria-label={isStreaming ? "停止生成" : queueLength > 0 ? "加入发送队列" : "发送消息"}
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-200",
                isStreaming || canSend
                  ? "border-transparent bg-gradient-to-b from-[var(--kp-brand-light)] to-[var(--kp-brand-dark)] text-white hover:from-[var(--kp-brand)] hover:to-[var(--kp-brand-dark)]"
                  : "border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
              )}
            >
              {isStreaming ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      <ChatInputChips
        onOpenSkillPicker={openSkillPicker}
        queueLength={queueLength}
        onFocusQueue={focusQueuePanel}
        selectedSkillName={selectedSkill?.name}
        onClearSkill={() => onSkillChange(null)}
      />

      {modelHint && (
        <p className="mt-1.5 px-1 text-center text-[11px] leading-relaxed text-[var(--kp-text-3)]">
          <span className="font-medium text-[var(--kp-text-2)]">{modelId}：</span>
          {modelHint}
        </p>
      )}
    </div>
  );
});
