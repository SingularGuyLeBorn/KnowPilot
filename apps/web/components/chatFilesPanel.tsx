"use client";
import { catchUnlessCancelled } from "@/lib/trpc";

import { useMemo, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Download,
  ArrowLeft,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  PanelRightClose,
  FileCode,
  Files,
} from "lucide-react";
import { trpc } from "../lib/trpc";
import type { ChatMessage, ChatImageAttachment } from "@knowpilot/shared";
import { PostContent } from "./post/PostContent";
import { toPascalCaseId } from "@/lib/toolDisplayName";

/** 从消息里提取的文件项 */
type ExtractedFile = {
  id: string;
  name: string;
  type: "image" | "markdown" | "text" | "file";
  /** 图片预览 URL / 文件下载 URL */
  url?: string;
  /** 文本内容（markdown/text 类预览用） */
  content?: string;
  mime?: string;
  /** 来源消息 id */
  messageId: string;
  /** 来源：用户上传 / agent 创建 */
  source: "upload" | "created";
  size?: string;
};

/** 从 toolCalls/toolResults 提取 agent 创建的文件（post_create/write_file/file_upload） */
function extractCreatedFiles(msg: ChatMessage): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
  const toolResults = (msg.toolResults ?? {}) as Record<string, unknown>;

  for (const call of toolCalls) {
    const c = call as { id?: string; name?: string; args?: Record<string, unknown>; result?: unknown };
    const name = c.name ?? "";
    const args = c.args ?? {};
    // result 可能在 call.result 或 toolResults[call.id]
    const result = (c.result ?? (c.id ? toolResults[c.id] : undefined)) as
      | Record<string, unknown>
      | undefined;

    // post_create / post_update：创建/更新知识库文章
    if (name === "post_create" || name === "post_update") {
      const title = String(args.title ?? result?.title ?? "未命名文章");
      const content = String(args.content ?? "");
      files.push({
        id: `post-${msg.id}-${c.id ?? name}`,
        name: `${title}.md`,
        type: "markdown",
        content,
        messageId: msg.id,
        source: "created",
      });
    }
    // write_file：写任意文件
    else if (name === "write_file") {
      const path = String(args.path ?? args.filePath ?? "");
      const content = String(args.content ?? "");
      const baseName = path.split("/").pop() || path || "未命名文件";
      const isMd = /\.md$/i.test(baseName);
      files.push({
        id: `wf-${msg.id}-${c.id ?? name}`,
        name: baseName,
        type: isMd ? "markdown" : "text",
        content,
        messageId: msg.id,
        source: "created",
      });
    }
    // file_upload：上传文件到 content/uploads
    else if (name === "file_upload") {
      const path = String(args.path ?? args.filePath ?? result?.path ?? "");
      const baseName = path.split("/").pop() || path || "上传文件";
      files.push({
        id: `fu-${msg.id}-${c.id ?? name}`,
        name: baseName,
        type: "file",
        url: path ? `/uploads/${path.replace(/^\/?uploads\/?/, "")}` : undefined,
        messageId: msg.id,
        source: "created",
      });
    }
  }
  return files;
}

function extractImageAttachments(msg: ChatMessage): ExtractedFile[] {
  const attachments = (msg.attachments ?? []) as ChatImageAttachment[];
  return attachments.map((a, i) => ({
    id: `img-${msg.id}-${i}`,
    name: a.name,
    type: "image" as const,
    url: a.previewUrl,
    mime: a.mimeType,
    messageId: msg.id,
    source: "upload" as const,
  }));
}

function fileIcon(type: ExtractedFile["type"]) {
  if (type === "image") return <ImageIcon className="h-4 w-4 text-[var(--kp-brand)]" />;
  if (type === "markdown") return <FileCode className="h-4 w-4 text-orange-600" />;
  return <FileText className="h-4 w-4 text-[var(--kp-text-2)]" />;
}

function downloadFile(file: ExtractedFile) {
  if (file.type === "image" && file.url) {
    // 图片：fetch blob 下载（避免直接打开）
    fetch(file.url)
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(catchUnlessCancelled("components/chatFilesPanel.tsx"));
    return;
  }
  if (file.content !== undefined) {
    // 文本/markdown：生成 blob 下载
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (file.url) {
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name;
    a.target = "_blank";
    a.click();
  }
}

function FilePreview({ file, onBack }: { file: ExtractedFile; onBack: () => void }) {
  const [maximized, setMaximized] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (file.content === undefined) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const header = (
    <div className="flex items-center gap-2 border-b border-[var(--kp-divider)] px-3 py-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg-alt)] hover:text-[var(--kp-text-1)]"
        aria-label="返回列表"
        title="返回列表"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="flex-1 truncate text-sm font-medium text-[var(--kp-text-1)]">{file.name}</span>
      {file.content !== undefined && (
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg-alt)] hover:text-[var(--kp-text-1)]"
          aria-label={copied ? "已复制" : "复制"}
          title={copied ? "已复制" : "复制"}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => downloadFile(file)}
        className="rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg-alt)] hover:text-[var(--kp-text-1)]"
        aria-label="下载"
        title="下载"
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setMaximized((v) => !v)}
        className="rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg-alt)] hover:text-[var(--kp-text-1)]"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
      >
        {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );

  const body = (
    <div className="flex-1 overflow-auto p-4">
      {file.type === "image" && file.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt={file.name} className="mx-auto max-w-full rounded-lg" />
      ) : file.type === "markdown" && file.content !== undefined ? (
        <PostContent content={file.content} className="prose-sm max-w-none" />
      ) : file.content !== undefined ? (
        <pre className="whitespace-pre-wrap break-words text-sm text-[var(--kp-text-1)]">{file.content}</pre>
      ) : file.url ? (
        <div className="text-sm text-[var(--kp-text-2)]">
          此文件类型无法直接预览，
          <a href={file.url} target="_blank" rel="noreferrer" className="text-[var(--kp-brand)] underline">
            点击打开
          </a>
        </div>
      ) : (
        <div className="text-sm text-[var(--kp-text-2)]">无可用预览内容</div>
      )}
    </div>
  );

  if (maximized) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--kp-bg)]" role="dialog" aria-modal="true">
        {header}
        {body}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      {body}
    </div>
  );
}

export function ChatFilesPanel({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = trpc.message.listForChat.useQuery(
    { sessionId: sessionId!, limit: 100 },
    { enabled: Boolean(sessionId && open), staleTime: 10_000 },
  );

  const files = useMemo<ExtractedFile[]>(() => {
    const msgs = (query.data?.items ?? []) as ChatMessage[];
    const all: ExtractedFile[] = [];
    for (const m of msgs) {
      all.push(...extractImageAttachments(m));
      all.push(...extractCreatedFiles(m));
    }
    return all;
  }, [query.data]);

  const selected = files.find((f) => f.id === selectedId) ?? null;

  if (!open) return null;

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-[var(--kp-divider)] bg-[var(--kp-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--kp-divider)] px-3 py-2">
        <Files className="h-4 w-4 text-[var(--kp-text-2)]" />
        <span className="flex-1 text-sm font-semibold text-[var(--kp-text-1)]">本会话文件</span>
        <span className="text-xs text-[var(--kp-text-3)]">{files.length}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--kp-text-2)] transition-colors hover:bg-[var(--kp-bg-alt)] hover:text-[var(--kp-text-1)]"
          aria-label="关闭面板"
          title="关闭面板"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {selected ? (
        <FilePreview file={selected} onBack={() => setSelectedId(null)} />
      ) : files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[var(--kp-text-3)]">
          <Files className="h-8 w-8 opacity-40" />
          <p>本会话暂无文件</p>
          <p className="text-xs">上传图片或让 Agent 创建文章后会出现在这里</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedId(f.id)}
              className="flex w-full items-center gap-3 border-b border-[var(--kp-divider)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--kp-bg-alt)]"
            >
              <span className="shrink-0">{fileIcon(f.type)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--kp-text-1)]">{f.name}</span>
                <span className="text-xs text-[var(--kp-text-3)]">
                  {f.source === "upload" ? "上传" : "Agent 创建"} · {toPascalCaseId(f.type)}
                </span>
              </span>
              <Download
                className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadFile(f);
                }}
              />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
