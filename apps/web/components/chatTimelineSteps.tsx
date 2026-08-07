"use client";

/**
 * Chat 时间线子组件——从 chat.tsx 拆出。
 * 包含 Thinking / Content / Tool 三类 step 与 ThinkingTimeline 容器。
 * 纯展示型，无外部状态依赖，可独立 memo / chunk。
 */

import { memo, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Clock,
  FileText,
  ListTodo,
  Loader2,
  MessageCircle,
  Minus,
  Sparkles,
  Square,
  X,
  ZoomIn,
} from "lucide-react";
import { PostContent } from "@/components/post/PostContent";
import { StreamingPlainContent } from "@/components/streamingPlainContent";
import { cn } from "@/lib/utils";
import { formatToolResultHint, type TimelineStep } from "@/lib/chatMessageUtils";
import { formatToolDisplayName } from "@/lib/toolDisplayName";
import { extractToolResultImages, type ToolResultImage } from "@/lib/toolResultImages";
import { ToolStepIcon, type ToolIconStatus } from "@/lib/toolIcons";
import { trpc } from "@/lib/trpc";

/** 从工具结果卡片解析落盘路径（压缩卡或短结果注解） */
function resolveOffloadPath(result: unknown): {
  path: string;
  originalChars?: number;
  compacted: boolean;
} | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  const path =
    (typeof r.path === "string" && r.offloaded === true && r.path) ||
    (typeof r._kp_result_path === "string" && r._kp_result_path) ||
    null;
  if (!path || !String(path).includes("tool-results")) return null;
  const originalChars =
    typeof r.originalChars === "number"
      ? r.originalChars
      : typeof r._kp_original_chars === "number"
        ? r._kp_original_chars
        : undefined;
  return { path: String(path).replace(/\\/g, "/"), originalChars, compacted: r.offloaded === true };
}

type TodoListItem = { id: string; content: string; status: string };

function parseTodoList(raw: unknown): TodoListItem[] | null {
  if (!raw || typeof raw !== "object") return null;
  const todos = (raw as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const items = todos
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      id: String(t.id ?? ""),
      content: String(t.content ?? ""),
      status: String(t.status ?? "pending"),
    }))
    .filter((t) => t.content);
  return items.length ? items : null;
}

/** todo_write 结果：SetTodoList 风格勾选清单（只读） */
const TodoWriteResult = memo(function TodoWriteResult({ items }: { items: TodoListItem[] }) {
  return (
    <ul
      className="space-y-0 overflow-hidden rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] py-1"
      data-testid="todo-write-list"
    >
      {items.map((t) => {
        const done = t.status === "completed";
        const cancelled = t.status === "cancelled";
        const inProgress = t.status === "in_progress";
        return (
          <li
            key={t.id || t.content}
            className={cn(
              "flex items-start gap-2.5 px-3 py-1.5 text-[11px]",
              inProgress && "border-l-2 border-l-[var(--kp-brand)] bg-[var(--kp-brand-soft)]/20 pl-2.5",
            )}
          >
            <span className="mt-0.5 shrink-0 text-[var(--kp-text-3)]" aria-hidden>
              {done ? (
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-[var(--kp-brand)] bg-[var(--kp-brand)] text-white">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              ) : cancelled ? (
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-[var(--kp-divider)] text-[var(--kp-text-3)]">
                  <Minus className="h-2.5 w-2.5" />
                </span>
              ) : (
                <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 leading-snug text-[var(--kp-text-2)]",
                (done || cancelled) && "text-[var(--kp-text-3)] line-through",
                inProgress && "font-medium text-[var(--kp-text-1)]",
              )}
            >
              {t.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
});

/** 工具结果截图预览：缩略图 + 点击全屏 */
const ToolResultImageGallery = memo(function ToolResultImageGallery({
  images,
}: {
  images: ToolResultImage[];
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (!images.length) return null;

  return (
    <>
      <div className="mb-2 space-y-2" data-testid="tool-result-images">
        <div className="text-[10px] font-medium text-[var(--kp-text-3)]">截图预览</div>
        <div className={cn("grid gap-2", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {images.map((img) => (
            <button
              key={img.src}
              type="button"
              className="group relative overflow-hidden rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)] text-left"
              onClick={() => setLightbox(img.src)}
              title="点击放大"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 动态 /uploads 路径，不走 next/image 优化 */}
              <img
                src={img.src}
                alt={img.label || "截图"}
                className="max-h-56 w-full object-contain object-top"
                loading="lazy"
              />
              <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                <ZoomIn className="h-3 w-3" />
                放大
              </span>
              {img.label && (
                <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1.5 py-0.5 text-[9px] text-white">
                  {img.label}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
          data-testid="tool-result-image-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="关闭预览"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="截图放大预览"
            className="max-h-[92vh] max-w-[96vw] rounded object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
});

/** 从 sleep / wait 工具参数推断目标时长（ms） */
function sleepTargetMs(name: string, args: unknown): number | null {
  const base = name.replace(/^skill__/, "").replace(/^mcp__/, "");
  if (base === "sleep" || base === "wait") {
    return sleepDurationFromArgs(args);
  }
  // async_task_run(mode=tool, toolCall={tool:sleep,args:{seconds}})
  if (base === "async_task_run" && args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    const toolCall = a.toolCall && typeof a.toolCall === "object"
      ? (a.toolCall as Record<string, unknown>)
      : null;
    const toolName = String(toolCall?.tool ?? a.tool ?? "");
    if (toolName !== "sleep" && toolName !== "wait") return null;
    const nested = (toolCall?.args ?? a.args ?? a.toolArgs) as unknown;
    return sleepDurationFromArgs(nested ?? a);
  }
  return null;
}

function sleepDurationFromArgs(args: unknown): number | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  if (typeof a.ms === "number" && Number.isFinite(a.ms)) return Math.max(0, a.ms);
  if (typeof a.seconds === "number" && Number.isFinite(a.seconds)) {
    return Math.max(0, Math.round(a.seconds * 1000));
  }
  return null;
}

function formatSleepCountdown(elapsedMs: number, targetMs: number | null): string {
  if (targetMs != null && targetMs > 0) {
    const remain = Math.max(0, targetMs - elapsedMs);
    const remainSec = Math.ceil(remain / 1000);
    const totalSec = Math.round(targetMs / 1000);
    if (remain <= 0) return `完成 · ${totalSec}s`;
    return `剩余 ${remainSec}s / ${totalSec}s`;
  }
  const sec = Math.floor(elapsedMs / 1000);
  return `已等待 ${sec}s`;
}

/**
 * 从工具名 + 参数推断执行模式（同步 / 异步）。
 * - sleep / wait：args.async === true → 异步；否则同步（默认阻塞）
 * - spawn_subagent / async_task_run：args.waitForResult === true → 同步；否则异步（默认投递）
 * 其余工具返回 null（不展示徽标）。
 */
function inferToolExecutionMode(
  name: string,
  args: unknown,
): { mode: "sync" | "async"; label: string } | null {
  const base = name.replace(/^skill__/, "").replace(/^mcp__/, "");
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;

  if (base === "sleep" || base === "wait") {
    const isAsync = a.async === true || a.async === "true";
    return { mode: isAsync ? "async" : "sync", label: isAsync ? "异步" : "同步" };
  }
  if (base === "spawn_subagent" || base === "async_task_run") {
    const waitForResult = a.waitForResult === true || a.waitForResult === "true";
    return { mode: waitForResult ? "sync" : "async", label: waitForResult ? "同步" : "异步" };
  }
  return null;
}

const ThinkingStep = memo(function ThinkingStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "thinking" }>;
  isLive?: boolean;
}) {
  const content = step.content.trim();
  const isEmpty = !content;
  // 默认展开；仅用户点击后折叠，结束后不自动改状态
  const [collapsed, setCollapsed] = useState(false);
  // 思考计时：仅 isLive 走表；结束后保留秒数（父级在正文/工具出现后会关掉 isLive）
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const start = Date.now();
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [isLive]);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 bg-[var(--kp-bg-soft)] px-3 py-2 text-left text-[11px] font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)]",
          !collapsed && "border-b border-[var(--kp-divider-light)]",
        )}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开思考" : "折叠思考"}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
        <span>Thinking{isLive ? "…" : ""}</span>
        {isLive && <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-brand)]" />}
        {elapsedSec > 0 && (
          <span className="text-[10px] tabular-nums text-[var(--kp-text-3)]">{elapsedSec}s</span>
        )}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200",
            collapsed ? "" : "rotate-90",
          )}
        />
      </button>
      {!collapsed && (
        <div className="max-h-[240vh] overflow-y-auto px-3 py-3">
          {isEmpty ? (
            isLive ? (
              <p className="text-xs text-[var(--kp-text-3)]">等待模型输出…</p>
            ) : null
          ) : isLive ? (
            <StreamingPlainContent
              content={content}
              className="prose-sm max-w-none text-xs text-[var(--kp-text-2)]"
            />
          ) : (
            <PostContent
              content={content}
              className="prose-sm max-w-none text-xs text-[var(--kp-text-2)] [&_p]:text-xs [&_li]:text-xs"
            />
          )}
        </div>
      )}
    </div>
  );
});

/** 中间正式回复（工具轮次中 probe 返回的 content，后续仍有工具调用）。进导轨，无圆点。
 *  样式与流式气泡 / 最终 assistant 气泡一致（rounded-2xl border px-4 py-3 prose-sm），
 *  避免「流式时大气泡 → 进时间线变平铺塌缩」的字体/块跳变。 */
const ContentStep = memo(function ContentStep({
  step,
}: {
  step: Extract<TimelineStep, { type: "content" }>;
}) {
  const content = step.content.trim();
  if (!content) return null;
  return (
    <div
      data-testid="intermediate-content-step"
      className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3.5 py-2 text-left text-sm text-[var(--kp-text-1)] shadow-sm"
    >
      <PostContent
        content={content.trimEnd()}
        className="prose-sm kp-chat-md max-w-none text-left"
      />
    </div>
  );
});

/** JSON 卡片形式：把对象递归渲染成缩进键值对列表（比裸 JSON 更友好） */
function JsonCardView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null) return <span className="text-[var(--kp-text-3)]">null</span>;
  if (typeof data === "boolean")
    return <span className="text-[var(--kp-brand-deep)]">{String(data)}</span>;
  if (typeof data === "number")
    return <span className="text-[var(--kp-brand)]">{String(data)}</span>;
  if (typeof data === "string") {
    const trimmed = data.length > 280 ? data.slice(0, 280) + "…" : data;
    return <span className="text-green-700">&quot;{trimmed}&quot;</span>;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span>[]</span>;
    return (
      <div
        className={cn(
          "space-y-0.5",
          depth > 0 && "border-l border-[var(--kp-divider-light)] pl-2",
        )}
      >
        {data.map((item, i) => (
          <div key={i} className="flex items-start gap-1">
            <span className="shrink-0 select-none text-[var(--kp-text-3)]">[{i}]</span>
            <JsonCardView data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span>{"{}"}</span>;
    return (
      <div
        className={cn(
          "space-y-0.5",
          depth > 0 && "border-l border-[var(--kp-divider-light)] pl-2",
        )}
      >
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start gap-1">
            <span className="shrink-0 select-none font-medium text-[var(--kp-text-2)]">
              {key}:
            </span>
            <JsonCardView data={value} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(data)}</span>;
}

const ToolStep = memo(function ToolStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "tool" }>;
  isLive?: boolean;
}) {
  const toolBaseName = step.name
    .replace(/^native:/, "")
    .replace(/^skill__/, "")
    .replace(/^mcp__/, "");
  const isTodoWrite = toolBaseName === "todo_write";
  // null = 跟随默认（todo 有清单则开）；用户点过 summary 后锁定
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [requestView, setRequestView] = useState<"json" | "card">("json");
  const [responseView, setResponseView] = useState<"json" | "card">("json");
  // UI 统一大驼峰（WriteFile）；底层 id 仍为 snake_case
  const displayName = formatToolDisplayName(step.name);
  const hasError =
    step.result &&
    typeof step.result === "object" &&
    step.result !== null &&
    "error" in (step.result as Record<string, unknown>);

  const targetMs = useMemo(() => sleepTargetMs(step.name, step.args), [step.name, step.args]);
  const showSleepTimer =
    step.status === "running" &&
    (targetMs != null || /(?:^|__)(?:sleep|wait)$/.test(step.name.replace(/^skill__|^mcp__/, "")));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showSleepTimer || !step.startedAt) return;
    // 立即同步 now，让计时器从 0 开始而非上次 render 的值；属外部时钟同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [showSleepTimer, step.startedAt, step.toolCallId]);

  const sleepHint =
    showSleepTimer && step.startedAt
      ? formatSleepCountdown(Math.max(0, now - step.startedAt), targetMs)
      : null;

  const execMode = useMemo(
    () => inferToolExecutionMode(step.name, step.args),
    [step.name, step.args],
  );

  const askUserPending = useMemo(() => {
    if (toolBaseName !== "ask_user" || !step.result || typeof step.result !== "object") return null;
    const r = step.result as {
      askUserPending?: {
        askId?: string;
        question?: string;
        options?: string[];
        channel?: "ui" | "email";
      };
      askId?: string;
      question?: string;
      options?: string[];
      channel?: "ui" | "email";
      status?: string;
      error?: unknown;
    };
    if (r.error) return null;
    const marker = r.askUserPending;
    const askId = marker?.askId || r.askId;
    const question = marker?.question || r.question;
    if (!askId || !question) return null;
    if (r.status && r.status !== "waiting_for_user") return null;
    return {
      askId: String(askId),
      question: String(question),
      options: marker?.options ?? r.options,
      channel: marker?.channel ?? r.channel ?? "ui",
    };
  }, [toolBaseName, step.result]);
  // ask_user 已答复：把用户回复从 result 里挑出来，工具框内专门渲染（不靠 JSON pre 块）
  const askUserAnswer = useMemo(() => {
    if (toolBaseName !== "ask_user" || !step.result || typeof step.result !== "object") return null;
    const r = step.result as { status?: string; answer?: string; source?: string };
    if (r.status === "answered" && typeof r.answer === "string" && r.answer.trim()) {
      return { answer: r.answer, source: r.source };
    }
    if (r.status === "expired" || r.status === "aborted") {
      return { answer: null, status: r.status };
    }
    return null;
  }, [toolBaseName, step.result]);
  // 优先 result；running/preparing 时用 args 预览
  const todoItems = useMemo(() => {
    if (!isTodoWrite) return null;
    return parseTodoList(step.result) ?? parseTodoList(step.args);
  }, [isTodoWrite, step.result, step.args]);

  const open = userOpen ?? (isTodoWrite && !!todoItems);

  // R18：JSON.stringify 仅在展开时计算（折叠时不浪费 CPU），且 memo 化避免重复 stringify
  const argsJson = useMemo(() => (open ? JSON.stringify(step.args, null, 2) : ""), [open, step.args]);
  const resultJson = useMemo(
    () => (open && step.result !== undefined && !todoItems ? JSON.stringify(step.result, null, 2) : ""),
    [open, step.result, todoItems],
  );
  const resultImages = useMemo(
    () => (step.result !== undefined ? extractToolResultImages(step.result) : []),
    [step.result],
  );
  const offload = useMemo(() => resolveOffloadPath(step.result), [step.result]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalOffset, setOriginalOffset] = useState(0);
  const originalQuery = trpc.session.readToolResult.useQuery(
    { path: offload?.path ?? "", offset: originalOffset, maxChars: 12_000 },
    { enabled: Boolean(offload?.path && showOriginal), staleTime: 30_000 },
  );

  const isPreparing = step.status === "preparing";
  const iconStatus: ToolIconStatus =
    step.status === "running" || isPreparing
      ? "running"
      : hasError
        ? "error"
        : step.status === "done"
          ? "done"
          : "idle";

  const waitingAsk = Boolean(askUserPending);

  return (
    <div
      data-testid="tool-pill"
      className={cn(
        "w-full overflow-hidden rounded-xl border shadow-sm transition-colors",
        step.status === "running" || waitingAsk || isPreparing
          ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30"
          : "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
      )}
    >
      <details open={open} className="group/tool" onToggle={(e) => setUserOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-[var(--kp-text-2)]">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              step.status === "running" || waitingAsk || isPreparing
                ? "animate-pulse bg-[var(--kp-brand)]"
                : hasError
                  ? "bg-red-500"
                  : "bg-green-500",
            )}
          />
          {isTodoWrite ? (
            <ListTodo className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
          ) : (
            <ToolStepIcon toolName={step.name} status={iconStatus} />
          )}
          <span className="min-w-0 truncate font-semibold text-[var(--kp-text-1)]">
            {displayName}
          </span>
          {isTodoWrite && (
            <span className="shrink-0 text-[10px] font-normal text-[var(--kp-text-3)]">
              更新待办
            </span>
          )}
          {execMode && !isTodoWrite && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                execMode.mode === "async"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-sky-100 text-sky-700",
              )}
              data-testid="tool-exec-mode"
            >
              {execMode.label}
            </span>
          )}
          {sleepHint && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums text-[var(--kp-brand)]"
              data-testid="tool-sleep-countdown"
            >
              <Clock className="h-3 w-3" />
              {sleepHint}
            </span>
          )}
          {/* preparing：模型仍在写工具参数，显示「准备中」而非裸 KB 数字 */}
          {isPreparing && !sleepHint && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--kp-brand)]"
              data-testid="tool-preparing-indicator"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              准备调用…
            </span>
          )}
          {(step.status === "running" || waitingAsk) && !sleepHint && !isPreparing && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--kp-brand)]"
              data-testid="tool-running-indicator"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              {waitingAsk ? "等待回复" : "运行中"}
            </span>
          )}
          {step.status === "done" && !isLive && !isTodoWrite && (
            <span
              className={cn(
                "ml-auto text-[10px]",
                hasError ? "text-red-600" : "text-[var(--kp-text-3)]",
              )}
              data-testid="tool-timing-hint"
            >
              {step.hint || formatToolResultHint(step.result) || (hasError ? "失败" : "")}
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200 group-open/tool:rotate-90" />
        </summary>
        {open && (
          <div className="border-t border-[var(--kp-divider-light)] px-3 py-2 space-y-2">
            {todoItems ? (
              <TodoWriteResult items={todoItems} />
            ) : askUserAnswer ? (
              <div className="space-y-2 text-[11px]">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--kp-text-3)]">
                  {argsJson}
                </pre>
                {askUserAnswer.answer ? (
                  <div
                    data-testid="ask-user-answer"
                    className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-2"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-green-700">
                      <MessageCircle className="h-3 w-3" />
                      用户答复
                      {askUserAnswer.source && (
                        <span className="text-[9px] text-green-600">
                          （{askUserAnswer.source === "email" ? "邮件" : askUserAnswer.source === "ui" ? "Chat" : askUserAnswer.source}）
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[11px] text-green-900">
                      {askUserAnswer.answer}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-700">
                    {askUserAnswer.status === "expired"
                      ? "等待超时，用户未在时限内答复"
                      : "等待被中止"}
                  </div>
                )}
              </div>
            ) : (
              <>
                {resultImages.length > 0 && <ToolResultImageGallery images={resultImages} />}
                {offload && (
                  <div
                    data-testid="tool-offload-panel"
                    className="rounded-lg border border-[var(--kp-brand-light)]/60 bg-[var(--kp-brand-soft)]/20 px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--kp-text-2)]">
                      <FileText className="h-3 w-3 shrink-0 text-[var(--kp-brand)]" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {offload.compacted ? "完整结果已落盘（上下文仅含元数据）" : "结果已落盘可追溯"}
                        {offload.originalChars != null ? ` · ${offload.originalChars} 字` : ""}
                      </span>
                      <button
                        type="button"
                        data-testid="tool-offload-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowOriginal((v) => !v);
                          if (!showOriginal) setOriginalOffset(0);
                        }}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                      >
                        {showOriginal ? "收起原文" : "查看原文"}
                      </button>
                    </div>
                    <p className="mt-1 truncate text-[9px] text-[var(--kp-text-3)]" title={offload.path}>
                      {offload.path}
                    </p>
                    {showOriginal && (
                      <div className="mt-2 space-y-1.5">
                        {originalQuery.isLoading && (
                          <div className="flex items-center gap-1 text-[10px] text-[var(--kp-brand)]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            加载原文…
                          </div>
                        )}
                        {originalQuery.isError && (
                          <p className="text-[10px] text-red-600">
                            {(originalQuery.error as { message?: string })?.message ?? "读取失败"}
                          </p>
                        )}
                        {originalQuery.data && (
                          <>
                            <pre
                              data-testid="tool-offload-content"
                              className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--kp-bg)] px-2 py-1.5 text-[10px] text-[var(--kp-text-2)]"
                            >
                              {originalQuery.data.content}
                            </pre>
                            <div className="flex items-center justify-between text-[9px] text-[var(--kp-text-3)]">
                              <span>
                                {originalQuery.data.offset}–
                                {originalQuery.data.offset + originalQuery.data.content.length} /{" "}
                                {originalQuery.data.totalChars}
                              </span>
                              {originalQuery.data.nextOffset != null && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOriginalOffset(originalQuery.data!.nextOffset!);
                                  }}
                                  className="font-semibold text-[var(--kp-brand-deep)] hover:underline"
                                >
                                  下一段
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Request */}
                <div className="group/request overflow-hidden rounded-lg bg-[var(--kp-bg-mute)]/50">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[10px] font-medium text-[var(--kp-text-3)]">Request</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRequestView((v) => (v === "json" ? "card" : "json"));
                      }}
                      className="opacity-0 transition group-hover/request:opacity-100 text-[9px] text-[var(--kp-text-3)] hover:text-[var(--kp-brand-deep)]"
                    >
                      {requestView === "json" ? "卡片" : "JSON"}
                    </button>
                  </div>
                  <div className="px-3 pb-2">
                    {requestView === "json" ? (
                      <pre className="max-h-48 overflow-hidden whitespace-pre-wrap text-[10px] text-[var(--kp-text-3)] group-hover/request:max-h-96 group-hover/request:overflow-y-auto">
                        {argsJson}
                      </pre>
                    ) : (
                      <div className="max-h-48 overflow-hidden text-[10px] text-[var(--kp-text-2)] group-hover/request:max-h-96 group-hover/request:overflow-y-auto">
                        <JsonCardView data={step.args} />
                      </div>
                    )}
                  </div>
                </div>
                {/* Response */}
                {step.result !== undefined && (
                  <div className="group/response overflow-hidden rounded-lg bg-[var(--kp-bg-mute)]/50">
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-[10px] font-medium text-[var(--kp-text-3)]">Response</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setResponseView((v) => (v === "json" ? "card" : "json"));
                        }}
                        className="opacity-0 transition group-hover/response:opacity-100 text-[9px] text-[var(--kp-text-3)] hover:text-[var(--kp-brand-deep)]"
                      >
                        {responseView === "json" ? "卡片" : "JSON"}
                      </button>
                    </div>
                    <div className="px-3 pb-2">
                      {responseView === "json" ? (
                        <pre className="max-h-48 overflow-hidden whitespace-pre-wrap text-[10px] text-[var(--kp-text-2)] group-hover/response:max-h-96 group-hover/response:overflow-y-auto">
                          {resultJson}
                        </pre>
                      ) : (
                        <div className="max-h-48 overflow-hidden text-[10px] text-[var(--kp-text-2)] group-hover/response:max-h-96 group-hover/response:overflow-y-auto">
                          <JsonCardView data={step.result} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </details>
    </div>
  );
});

const ProgressStep = memo(function ProgressStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "progress" }>;
  isLive?: boolean;
}) {
  const status = step.status;
  const icon =
    status === "failed" ? (
      <X className="h-3.5 w-3.5 shrink-0 text-red-500" />
    ) : status === "done" ? (
      <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
    ) : status === "queued" ? (
      <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
    ) : (
      <Loader2 className={cn("h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]", isLive && "animate-spin")} />
    );
  return (
    <div
      data-testid="async-progress-step"
      className={cn(
        "w-full overflow-hidden rounded-xl border px-3 py-2 text-[11px] shadow-sm transition-colors",
        status === "failed"
          ? "border-red-200 bg-red-50"
          : status === "done"
            ? "border-green-200 bg-green-50"
            : "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30",
      )}
    >
      <div className="flex items-center gap-2 font-medium text-[var(--kp-text-2)]">
        {icon}
        <span className="min-w-0 truncate">{step.label}</span>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--kp-text-3)]">
          {status === "queued" && "排队中"}
          {status === "running" && "运行中"}
          {status === "done" && "已完成"}
          {status === "failed" && "失败"}
        </span>
      </div>
      {step.content && (
        <p className="mt-1 line-clamp-2 text-[10px] text-[var(--kp-text-3)]">{step.content}</p>
      )}
    </div>
  );
});

export function ThinkingTimeline({
  steps,
  isLive = false,
}: {
  steps: TimelineStep[];
  isLive?: boolean;
}) {
  // 历史/非末尾的空 Thinking 一律不渲染；直播中仅保留「正在等首 token」的最后一个空壳
  const visibleSteps = steps.filter((step, i) => {
    if (step.type !== "thinking") return true;
    if (step.content.trim()) return true;
    return isLive && i === steps.length - 1;
  });
  if (!visibleSteps.length) return null;

  // 左右边缘与 assistant 气泡完全对齐（同 ml-6 mr-2 max-w-[96%]，无内缩），
  // 避免中间回复「流式全宽 → 进时间线变窄」的跳变。
  // 竖线导轨放在气泡左侧 margin 区（absolute 负偏移，不占布局宽度），对标 Kimi Code。
  return (
    <div
      className="relative mb-2 ml-6 mr-2 w-full max-w-[96%]"
      data-testid="thinking-timeline"
    >
      <div className="absolute -left-4 bottom-2 top-2 w-0.5 bg-[var(--kp-brand-light)]/40" />
      <div className="min-w-0 space-y-3">
        {visibleSteps.map((step, i) => {
          const key =
            step.type === "tool"
              ? step.toolCallId
              : step.type === "progress"
                ? `progress-${step.jobId}`
                : step.type === "content"
                  ? `content-${step.round}-${i}`
                  : `thinking-${step.round}-${i}`;
          // 圆点仅给 thinking；content / tool 共享竖线但不画圆点（对标 Kimi Code）
          return (
            <div key={key} className="relative">
              {step.type === "thinking" && (
                <span className="absolute -left-5 top-2 h-2.5 w-2.5 rounded-full bg-[var(--kp-brand)] ring-2 ring-[var(--kp-bg-alt)]" />
              )}
              {step.type === "thinking" ? (
                <ThinkingStep step={step} isLive={isLive && i === visibleSteps.length - 1} />
              ) : step.type === "content" ? (
                <ContentStep step={step} />
              ) : step.type === "progress" ? (
                <ProgressStep step={step} isLive={isLive} />
              ) : (
                <ToolStep step={step} isLive={isLive} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
