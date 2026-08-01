"use client";

import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Bot,
  Check,
  FileText,
  Flag,
  Loader2,
  Mic,
  Search,
  Send,
  Square,
  X,
} from "lucide-react";
import type { ChatPostAttachment, ChatSessionConfig, Skill } from "@knowpilot/shared";
import { LucideIconByName, ChatShortcutHints } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import type { ChatQueueAttachment, ChatQueueImageAttachment } from "@/lib/chatQueueTypes";
import { ChatModelMenu } from "@/components/chatModelMenu";
import { ChatInputChips } from "@/components/chatInputChips";
import { useSpeechRecognition } from "@/lib/useSpeechRecognition";
import {
  restoreDraftAfterQueueEdit,
  stashDraftOnEnterQueueEdit,
} from "@/lib/queueEditDraft";

/** 发送时注入 LLM 的正文上限（字符）；更长用工具续读 */
const POST_SNIPPET_MAX = 12_000;

export interface SelectedSkill {
  id: string;
  name: string;
  icon?: string | null;
  description: string;
  code: string;
}

export type QueueEditTarget = { id: string; text: string };

interface ChatInputAreaProps {
  onSend: (
    text: string,
    skill?: SelectedSkill,
    attachments?: ChatQueueAttachment[],
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
  modelSupportsReasoning: boolean;
  modelReasoningRequired: boolean;
  /** 会话级提示（如子代理任务会话警告），显示在输入框上方 */
  sessionHint?: string;
  /** 当前会话 ID，用于隔离上键历史恢复 */
  sessionId?: string | null;
  /** 子会话不展示 /goal|/research 命令 */
  isSubagentSession?: boolean;
  /** 深度调研仅新会话首条前可选 */
  canStartDeepResearch?: boolean;
  /** Cursor 式编辑队列项：非 null 时输入框处于「Edit Queued」态 */
  queueEdit?: QueueEditTarget | null;
  onCommitQueueEdit?: (id: string, text: string) => void;
  onCancelQueueEdit?: () => void;
  /** 集群 pill：打开左侧 Agent / 会话树 */
  onFocusSwarm?: () => void;
  /** 输入框聚焦时提前拉取 Skill 列表 */
  onWarmSkills?: () => void;
}

type SlashCommandItem = {
  id: string;
  label: string;
  insert: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
};

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
  modelSupportsReasoning,
  modelReasoningRequired,
  sessionHint,
  sessionId,
  isSubagentSession = false,
  canStartDeepResearch = false,
  queueEdit = null,
  onCommitQueueEdit,
  onFocusSwarm,
  onWarmSkills,
  onCancelQueueEdit,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 发送防重入锁：ref 在同步阶段立即生效，避免 React state 批处理导致双击/双快捷键穿透
  const sendLockRef = useRef(false);

  // 输入框 value 内部自管理，避免每个字符都触发外层 ChatView 重渲染
  const [input, setInput] = useState("");
  const inputRef = useRef(input);
  inputRef.current = input;
  /** 编辑队列前备份的草稿（提交/取消后还原，保证 abcde 不丢） */
  const queueEditDraftBackupRef = useRef<string | null>(null);
  const queueEditActiveIdRef = useRef<string | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [pendingPosts, setPendingPosts] = useState<ChatPostAttachment[]>([]);
  const [postFetchError, setPostFetchError] = useState<string | null>(null);

  const openSkillPicker = useCallback(() => {
    onWarmSkills?.();
    textareaRef.current?.focus();
    setMentionOpen(false);
    setSkillQuery("");
    setSkillOpen(true);
    setHighlightIdx(0);
  }, [onWarmSkills]);

  const openMentionPicker = useCallback(() => {
    textareaRef.current?.focus();
    setSkillOpen(false);
    setMentionQuery("");
    setMentionOpen(true);
    setHighlightIdx(0);
  }, []);

  const focusQueuePanel = useCallback(() => {
    document
      .querySelector<HTMLElement>("[data-testid='chat-queue-panel']")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const insertGoalPrefix = useCallback(() => {
    setInput((prev) => {
      const t = prev.trim();
      if (!t) return "/goal ";
      if (/^\/(goal|research|deepresearch|deep-research)\b/i.test(t)) return prev;
      return `/goal ${prev}`;
    });
    textareaRef.current?.focus();
  }, []);
  const [pendingImages, setPendingImages] = useState<ChatQueueImageAttachment[]>([]);
  /** 正在 OCR 的附件 id → true（蒙版按图显示，而非整栏一个 loading） */
  const [ocrInFlight, setOcrInFlight] = useState<Record<string, boolean>>({});
  const [ocrError, setOcrError] = useState<string | null>(null);
  const ocrLoading = Object.keys(ocrInFlight).length > 0;
  // 发送按钮防抖/防重入：用 ref 锁 + state 同步禁用按钮，避免 React state 批处理导致双击/双快捷键穿透
  const [isSending, setIsSending] = useState(false);

  // 移动端虚拟键盘：用 visualViewport 抬高输入区，避免遮挡
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const sync = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kp-keyboard-inset", `${inset}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--kp-keyboard-inset");
    };
  }, []);

  // 语音输入：webkitSpeechRecognition 实时转写，interim/final 追加到 input 末尾
  const voiceBaseRef = useRef("");
  const { supported: sttSupported, listening, error: sttError, start: sttStart, stop: sttStop } =
    useSpeechRecognition(
      { lang: "zh-CN", interimResults: true, continuous: false },
      {
        onInterim: (t) => setInput((voiceBaseRef.current + t).replace(/\s+$/, " ")),
        onFinal: (t) => {
          const merged = (voiceBaseRef.current ? voiceBaseRef.current.replace(/\s+$/, "") + " " : "") + t;
          voiceBaseRef.current = merged + " ";
          setInput(voiceBaseRef.current);
        },
      },
    );
  useEffect(() => {
    if (!listening) voiceBaseRef.current = input;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  // 上键历史恢复：按 sessionId 隔离，存 localStorage
  const historyKey = sessionId ? `kp-input-history:${sessionId}` : null;
  const [historyIdx, setHistoryIdx] = useState(-1); // -1 = 不在浏览历史模式
  const [draftBackup, setDraftBackup] = useState(""); // 浏览历史前的草稿备份

  // UX #6：切会话聚焦 + 清空草稿（原靠 key remount，现 pane 稳定挂载需显式重置）
  useEffect(() => {
    setInput("");
    setSkillOpen(false);
    setSkillQuery("");
    setMentionOpen(false);
    setMentionQuery("");
    setHighlightIdx(0);
    setPendingImages([]);
    setPendingPosts([]);
    setOcrError(null);
    setPostFetchError(null);
    setHistoryIdx(-1);
    setDeepResearchEnabled(false);
    queueEditDraftBackupRef.current = null;
    queueEditActiveIdRef.current = null;
    textareaRef.current?.focus();
  }, [sessionId]);

  useEffect(() => {
    if (!canStartDeepResearch) setDeepResearchEnabled(false);
  }, [canStartDeepResearch]);

  // Cursor 式编辑队列：进入时备份草稿并载入队列正文；父级清空时还原备份
  useEffect(() => {
    const editId = queueEdit?.id ?? null;
    if (editId && queueEdit) {
      queueEditDraftBackupRef.current = stashDraftOnEnterQueueEdit({
        alreadyEditingId: queueEditActiveIdRef.current,
        currentBackup: queueEditDraftBackupRef.current,
        currentInput: inputRef.current,
      });
      if (queueEditActiveIdRef.current !== editId) {
        queueEditActiveIdRef.current = editId;
        setInput(queueEdit.text);
        setHistoryIdx(-1);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
      return;
    }
    if (queueEditActiveIdRef.current !== null) {
      const backup = queueEditDraftBackupRef.current;
      queueEditDraftBackupRef.current = null;
      queueEditActiveIdRef.current = null;
      setInput(restoreDraftAfterQueueEdit(backup));
    }
  }, [queueEdit?.id, queueEdit?.text, queueEdit]);

  const finishQueueEditLocally = useCallback(() => {
    const backup = queueEditDraftBackupRef.current;
    queueEditDraftBackupRef.current = null;
    queueEditActiveIdRef.current = null;
    setInput(restoreDraftAfterQueueEdit(backup));
    setHistoryIdx(-1);
  }, []);

  const cancelQueueEdit = useCallback(() => {
    finishQueueEditLocally();
    onCancelQueueEdit?.();
  }, [finishQueueEditLocally, onCancelQueueEdit]);

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
  const utils = trpc.useUtils();
  const postTreeQuery = trpc.post.tree.useQuery({}, { staleTime: 5 * 60 * 1000 });
  const postSearchQuery = trpc.post.search.useQuery(
    { query: mentionQuery.trim() || "a", limit: 20 },
    { enabled: mentionOpen && mentionQuery.trim().length > 0, staleTime: 30_000 },
  );

  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [] as Array<{ id: string; garden: string; slug: string; title: string }>;
    const q = mentionQuery.trim().toLowerCase();
    if (q && postSearchQuery.data?.length) {
      return postSearchQuery.data.map((p) => ({
        id: p.id,
        garden: p.garden,
        slug: p.slug,
        title: p.title,
      }));
    }
    const tree = postTreeQuery.data ?? [];
    if (!q) return tree.slice(0, 40);
    return tree
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.garden.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [mentionOpen, mentionQuery, postSearchQuery.data, postTreeQuery.data]);

  const enabledSkills = skills.filter((s) => s.enabled);

  const slashCommands: SlashCommandItem[] = isSubagentSession
    ? []
    : [
        {
          id: "goal",
          label: "/goal",
          insert: "/goal ",
          description: "设定会话目标并开始（也可 pause|resume|clear|status）",
        },
        {
          id: "research",
          label: "/research",
          insert: "/research ",
          description: canStartDeepResearch
            ? "启动深度调研（仅新会话首条消息前）"
            : "深度调研只能在新会话首条消息前选择",
          disabled: !canStartDeepResearch,
          disabledReason: "仅新会话首条前可选",
        },
      ];

  const q = skillQuery.toLowerCase();
  const filteredCommands = slashCommands.filter(
    (c) =>
      !q ||
      c.label.toLowerCase().includes(q) ||
      c.id.includes(q) ||
      c.description.toLowerCase().includes(q),
  );
  const filteredSkills = enabledSkills.filter((s) => {
    return (
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });

  type PickerRow =
    | { kind: "cmd"; cmd: SlashCommandItem }
    | { kind: "skill"; skill: Skill };
  const pickerRows: PickerRow[] = [
    ...filteredCommands.map((cmd) => ({ kind: "cmd" as const, cmd })),
    ...filteredSkills.map((skill) => ({ kind: "skill" as const, skill })),
  ];
  const pickerHasContent = pickerRows.length > 0 || skillOpen;

  const detectTriggers = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const mentionMatch = before.match(/@([\w\u4e00-\u9fff-]*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1] ?? "");
      setMentionOpen(true);
      setSkillOpen(false);
      setSkillQuery("");
      setHighlightIdx(0);
      return;
    }
    setMentionOpen(false);
    setMentionQuery("");
    const slashMatch = before.match(/\/([\w-]*)$/);
    if (slashMatch) {
      setSkillQuery(slashMatch[1] ?? "");
      setSkillOpen(true);
      setHighlightIdx(0);
    } else {
      setSkillOpen(false);
      setSkillQuery("");
    }
  };

  const activeHighlightIdx =
    mentionOpen && mentionCandidates.length > 0
      ? Math.min(highlightIdx, mentionCandidates.length - 1)
      : skillOpen && pickerRows.length > 0
        ? Math.min(highlightIdx, pickerRows.length - 1)
        : 0;

  const replaceSlashPrefix = (replacement: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const before = input.slice(0, ta.selectionStart);
      const after = input.slice(ta.selectionStart);
      const cleaned = before.replace(/\/[\w-]*$/, "");
      setInput(cleaned + replacement + after);
    } else {
      setInput(input.replace(/\/[\w-]*$/, "") + replacement);
    }
    setSkillOpen(false);
    textareaRef.current?.focus();
  };

  const selectSkill = (skill: Skill) => {
    onSkillChange({
      id: skill.id,
      name: skill.name,
      icon: skill.icon,
      description: skill.description,
      code: skill.code,
    });
    replaceSlashPrefix("");
  };

  const selectCommand = (cmd: SlashCommandItem) => {
    if (cmd.disabled) return;
    replaceSlashPrefix(cmd.insert);
  };

  const activatePickerRow = (row: PickerRow) => {
    if (row.kind === "cmd") selectCommand(row.cmd);
    else selectSkill(row.skill);
  };

  const stripMentionPrefix = () => {
    const ta = textareaRef.current;
    if (ta) {
      const before = input.slice(0, ta.selectionStart);
      const after = input.slice(ta.selectionStart);
      setInput(before.replace(/@[\w\u4e00-\u9fff-]*$/, "") + after);
    } else {
      setInput(input.replace(/@[\w\u4e00-\u9fff-]*$/, ""));
    }
    setMentionOpen(false);
    setMentionQuery("");
    textareaRef.current?.focus();
  };

  const selectPostMention = async (post: {
    id: string;
    garden: string;
    slug: string;
    title: string;
  }) => {
    if (pendingPosts.some((p) => p.id === post.id)) {
      stripMentionPrefix();
      return;
    }
    setPostFetchError(null);
    stripMentionPrefix();
    try {
      const full = await utils.post.getById.fetch({ id: post.id });
      const content = typeof full.content === "string" ? full.content : "";
      const att: ChatPostAttachment = {
        type: "post",
        id: full.id,
        garden: full.garden,
        slug: full.slug,
        title: full.title,
        excerpt: full.excerpt ?? undefined,
        contentSnippet: content.slice(0, POST_SNIPPET_MAX) || undefined,
      };
      setPendingPosts((prev) => [...prev.filter((p) => p.id !== att.id), att]);
    } catch (err: unknown) {
      setPostFetchError(err instanceof Error ? err.message : "加载文章失败");
    }
  };

  const runOcrForAttachment = async (
    att: ChatQueueImageAttachment,
  ): Promise<ChatQueueImageAttachment> => {
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
    let text = input.trim();
    if (
      (!text && pendingImages.length === 0 && pendingPosts.length === 0) ||
      disabled ||
      ocrLoading ||
      sendLockRef.current
    ) {
      return;
    }
    sendLockRef.current = true;
    setIsSending(true);

    // Cursor 式：提交队列编辑 → 写回队列项 + 还原进入编辑前的草稿（abcde 不丢）
    const editingId = queueEditActiveIdRef.current;
    if (editingId && onCommitQueueEdit) {
      onCommitQueueEdit(editingId, text);
      finishQueueEditLocally();
      sendLockRef.current = false;
      setTimeout(releaseSendLock, 300);
      return;
    }

    // 深度研究 chip：发送时自动补 /research 前缀（与 enqueue 斜杠语义一致）
    if (
      deepResearchEnabled &&
      canStartDeepResearch &&
      text &&
      !/^\/(research|deepresearch|deep-research|goal)\b/i.test(text)
    ) {
      text = `/research ${text}`;
    }

    let imageAtts = pendingImages;
    const needsOcr = !supportsVision && imageAtts.some((a) => !a.extractedText);
    if (needsOcr) {
      const ids = imageAtts.filter((a) => !a.extractedText).map((a) => a.id);
      setOcrInFlight((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = true;
        return next;
      });
      setOcrError(null);
      try {
        imageAtts = await Promise.all(imageAtts.map(runOcrForAttachment));
      } catch (err: unknown) {
        setOcrError(err instanceof Error ? err.message : "OCR 识别失败");
        releaseSendLock();
        return;
      } finally {
        setOcrInFlight((prev) => {
          const next = { ...prev };
          for (const id of ids) delete next[id];
          return next;
        });
      }
    }

    const attachments: ChatQueueAttachment[] = [...pendingPosts, ...imageAtts];
    onSend(
      text,
      selectedSkill ?? undefined,
      attachments.length ? attachments : undefined,
    );
    setInput(""); // 清空输入框（状态内部化后由组件自行清空）
    pushHistory(text); // 记录到上键历史
    onSkillChange(null);
    setPendingImages([]);
    setPendingPosts([]);
    setOcrError(null);
    setPostFetchError(null);
    setMentionOpen(false);
    setHistoryIdx(-1); // 退出历史浏览模式
    setDeepResearchEnabled(false);
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
      const att: ChatQueueImageAttachment = {
        id,
        name: file.name,
        mimeType: file.type,
        previewUrl,
        source: supportsVision ? "vision" : "ocr",
      };
      setOcrError(null);
      setPendingImages((prev) => [...prev, att]);

      if (!supportsVision) {
        setOcrInFlight((prev) => ({ ...prev, [id]: true }));
        runOcrForAttachment(att)
          .then((done) => {
            setPendingImages((prev) => prev.map((x) => (x.id === id ? done : x)));
          })
          .catch((err: unknown) => {
            setOcrError(err instanceof Error ? err.message : "OCR 识别失败");
            setPendingImages((prev) => prev.filter((x) => x.id !== id));
          })
          .finally(() => {
            setOcrInFlight((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          });
      }
    };
    reader.readAsDataURL(file);
  };

  const isEditingQueue = !!queueEdit?.id;
  const canSend =
    (!!input.trim() ||
      (!isEditingQueue && (pendingImages.length > 0 || pendingPosts.length > 0))) &&
    !disabled &&
    !ocrLoading &&
    !isSending;
  const placeholderHint = disabled
    ? "后端未连接"
    : isEditingQueue
      ? "编辑队列消息，发送后写回队列并恢复原草稿"
      : deepResearchEnabled && canStartDeepResearch
        ? "深度研究已开启：发送将走 /research …"
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
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--kp-brand-soft)]/70 px-2.5 py-1 text-xs font-medium text-[var(--kp-brand-deep)]">
            <LucideIconByName name={selectedSkill.icon} className="h-3 w-3" />
            {selectedSkill.name}
          </span>
          <button
            type="button"
            onClick={() => onSkillChange(null)}
            className="rounded-lg p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            aria-label="清除 Skill"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-[var(--kp-text-3)]">将作为本轮系统指引</span>
        </div>
      )}

      {mentionOpen && (
        <div
          className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1 shadow-lg"
          data-testid="chat-mention-picker"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--kp-text-3)]">
            引用文章{mentionQuery ? ` · ${mentionQuery}` : ""}
          </div>
          {mentionCandidates.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--kp-text-3)]">
              {mentionQuery.trim()
                ? postSearchQuery.isFetching
                  ? "搜索中…"
                  : "无匹配文章"
                : postTreeQuery.isLoading
                  ? "加载文章列表…"
                  : "输入标题或 slug 过滤，或从下方挑选"}
            </div>
          ) : (
            mentionCandidates.map((post, idx) => (
              <button
                key={post.id}
                type="button"
                onClick={() => {
                  selectPostMention(post).catch(catchUnlessCancelled("components/chatInput.tsx"));
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                  idx === activeHighlightIdx
                    ? "bg-[var(--kp-brand-soft)]"
                    : "hover:bg-[var(--kp-bg-mute)]",
                )}
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
                <div className="min-w-0">
                  <div className="font-medium text-[var(--kp-text-1)]">{post.title}</div>
                  <div className="truncate text-xs text-[var(--kp-text-3)]">
                    {post.garden}/{post.slug}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {skillOpen && pickerHasContent && !mentionOpen && (
        <div
          className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1 shadow-lg"
          data-testid="chat-slash-picker"
        >
          {!isSubagentSession && filteredCommands.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--kp-text-3)]">
                命令
              </div>
              {filteredCommands.map((cmd) => {
                const rowIdx = pickerRows.findIndex((r) => r.kind === "cmd" && r.cmd.id === cmd.id);
                const disabled = !!cmd.disabled;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectCommand(cmd)}
                    title={disabled ? cmd.disabledReason : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                      disabled && "cursor-not-allowed opacity-45",
                      !disabled && rowIdx === activeHighlightIdx
                        ? "bg-[var(--kp-brand-soft)]"
                        : !disabled && "hover:bg-[var(--kp-bg-mute)]",
                    )}
                  >
                    {cmd.id === "research" ? (
                      <Search className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
                    ) : (
                      <Flag className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--kp-text-1)]">{cmd.label}</div>
                      <div className="truncate text-xs text-[var(--kp-text-3)]">
                        {cmd.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--kp-text-3)]">
            已启用 Skill{enabledSkills.length === 0 ? "（当前无）" : ` · ${enabledSkills.length}`}
          </div>
          {filteredSkills.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--kp-text-3)]">
              无匹配项。Skill 来自 content/skills 且标记为启用的条目。
            </div>
          ) : (
            filteredSkills.map((skill) => {
              const rowIdx = pickerRows.findIndex(
                (r) => r.kind === "skill" && r.skill.id === skill.id,
              );
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => selectSkill(skill)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                    rowIdx === activeHighlightIdx
                      ? "bg-[var(--kp-brand-soft)]"
                      : "hover:bg-[var(--kp-bg-mute)]",
                  )}
                >
                  <LucideIconByName
                    name={skill.icon}
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--kp-text-1)]">{skill.name}</div>
                    <div className="truncate text-xs text-[var(--kp-text-3)]">{skill.description}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      <div
        className={cn(
          "kp-chat-composer overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] transition-colors",
          "focus-within:border-[var(--kp-accent)]",
          deepResearchEnabled &&
            canStartDeepResearch &&
            "border-[var(--kp-accent)]/50 bg-[var(--kp-brand-soft)]/15",
          disabled && "opacity-60",
        )}
      >
        {/* 文章引用 chip + 图片预览 */}
        {(pendingPosts.length > 0 || pendingImages.length > 0) && (
          <div
            data-testid="chat-attachment-previews"
            className="flex flex-wrap gap-2 px-3 pt-3"
          >
            {pendingPosts.map((post) => (
              <div
                key={post.id}
                className="relative inline-flex max-w-[min(100%,16rem)] items-start gap-1.5 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/40 px-2.5 py-1.5"
                data-testid="chat-pending-post"
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
                <span className="min-w-0 pr-4">
                  <span className="line-clamp-2 text-xs font-medium text-[var(--kp-text-1)]">
                    {post.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--kp-text-3)]">
                    {post.garden}/{post.slug}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setPendingPosts((p) => p.filter((x) => x.id !== post.id))}
                  className="absolute right-1 top-1 rounded-full p-0.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
                  aria-label="移除文章引用"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {pendingImages.map((img) => {
              const isOcring = Boolean(ocrInFlight[img.id]);
              return (
                <div
                  key={img.id}
                  className="relative h-16 w-16 overflow-hidden rounded-xl"
                  data-testid="chat-image-preview"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.previewUrl}
                    alt={img.name}
                    className={cn("h-full w-full object-cover", isOcring && "scale-[1.02]")}
                  />
                  {isOcring && (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[rgba(28,26,24,0.55)]"
                      data-testid="chat-ocr-loading"
                      aria-label="OCR 识别中"
                    >
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                      <span className="text-[9px] font-medium text-white/90">OCR</span>
                    </div>
                  )}
                  {!supportsVision && !isOcring && img.extractedText && (
                    <span
                      data-testid="chat-ocr-ready"
                      className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-0.5 bg-emerald-600/85 py-0.5 text-[9px] text-white"
                      title={img.extractedText.slice(0, 200)}
                    >
                      <Check className="h-2.5 w-2.5" />
                      完成
                    </span>
                  )}
                  {!isOcring && (
                    <button
                      type="button"
                      onClick={() => setPendingImages((p) => p.filter((x) => x.id !== img.id))}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/55 p-0.5 text-white transition hover:bg-black/75"
                      aria-label="移除图片"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(ocrError || postFetchError) && (
          <div data-testid="chat-ocr-error" className="px-3 pt-2 text-xs text-red-600">
            {ocrError || postFetchError}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onFocus={() => onWarmSkills?.()}
            onChange={(e) => {
              setInput(e.target.value);
              detectTriggers(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) => detectTriggers(input, e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (mentionOpen && mentionCandidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.min(i + 1, mentionCandidates.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  selectPostMention(mentionCandidates[activeHighlightIdx]!).catch(catchUnlessCancelled("components/chatInput.tsx"));
                  return;
                }
                if (e.key === "Escape") {
                  setMentionOpen(false);
                  return;
                }
              }
              if (skillOpen && pickerRows.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.min(i + 1, pickerRows.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  activatePickerRow(pickerRows[activeHighlightIdx]!);
                  return;
                }
                if (e.key === "Escape") {
                  setSkillOpen(false);
                  return;
                }
              }
              if (e.key === "Escape" && queueEditActiveIdRef.current) {
                e.preventDefault();
                cancelQueueEdit();
                return;
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
              }
              // 上键恢复历史消息（picker 关闭时）
              if (
                !skillOpen &&
                !mentionOpen &&
                e.key === "ArrowUp" &&
                textareaRef.current?.selectionStart === 0
              ) {
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
              if (!skillOpen && !mentionOpen && e.key === "ArrowDown" && historyIdx !== -1) {
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
            className={cn(
              "min-h-[88px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed",
              "text-[var(--kp-text-1)] caret-[var(--kp-text-1)] disabled:cursor-not-allowed",
              // 覆盖 globals.css 的 textarea:focus-visible 描边——否则聚焦时底部 outline 会像一条横线劈开输入框
              "outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
            )}
          />
          {!disabled && !input.trim() && (
            <div className="pointer-events-none absolute inset-0 px-4 py-3" aria-hidden>
              <span className="text-sm text-[var(--kp-text-3)]">{placeholderHint}</span>
            </div>
          )}
        </div>

        {/* 底栏：语音 / 模型 / 发送（能力入口下移为 Kimi 式动态 pill） */}
        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="flex items-center gap-0.5">
            {isEditingQueue && (
              <span
                data-testid="chat-edit-queued-chip"
                className="mr-1 inline-flex items-center gap-1 rounded-full border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/60 px-2.5 py-1 text-[11px] font-medium text-[var(--kp-brand-deep)]"
              >
                Edit Queued
                <button
                  type="button"
                  onClick={cancelQueueEdit}
                  className="rounded-full p-0.5 hover:bg-[var(--kp-brand-soft)]"
                  aria-label="取消编辑队列"
                  title="取消编辑，恢复原草稿"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
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
            {sttSupported && (
              <button
                type="button"
                disabled={disabled}
                onClick={listening ? sttStop : () => { voiceBaseRef.current = input; sttStart(); }}
                data-testid="chat-voice-input"
                className={cn(
                  "inline-flex items-center justify-center rounded-lg p-1.5 transition disabled:opacity-50",
                  listening
                    ? "bg-red-500/15 text-red-500 hover:bg-red-500/25"
                    : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand-deep)]",
                )}
                title={
                  sttError
                    ? sttError
                    : listening
                      ? "正在听…点击停止"
                      : "语音输入（浏览器原生，免费）"
                }
                aria-label={listening ? "停止语音输入" : "开始语音输入"}
              >
                <Mic className={cn("h-4 w-4", listening && "animate-pulse")} />
              </button>
            )}
            <ChatShortcutHints isStreaming={isStreaming} />
          </div>

          <div className="flex items-center gap-1.5">
            <ChatModelMenu
              chatConfig={chatConfig}
              updateConfig={updateConfig}
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

      {/* Kimi 式动态 icon pill：悬停微动效，激活态循环呼吸 */}
      <ChatInputChips
        disabled={disabled || ocrLoading}
        isSubagentSession={isSubagentSession}
        deepResearchEnabled={deepResearchEnabled}
        canStartDeepResearch={canStartDeepResearch}
        onToggleDeepResearch={() => {
          if (!canStartDeepResearch) return;
          setDeepResearchEnabled((v) => !v);
        }}
        selectedSkillName={selectedSkill?.name}
        onOpenSkillPicker={openSkillPicker}
        onInsertGoal={insertGoalPrefix}
        onOpenMention={openMentionPicker}
        onAttachImage={() => fileRef.current?.click()}
        onFocusSwarm={onFocusSwarm}
        queueLength={queueLength}
        onFocusQueue={focusQueuePanel}
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
