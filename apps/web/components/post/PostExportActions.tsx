"use client";

import { useState } from "react";
import { Download, FileDown, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { exportPostMarkdownZip, exportPostPdf, type PostExportInput } from "@/lib/postExport";

interface PostExportActionsProps {
  post: PostExportInput;
  articleRef: React.RefObject<HTMLElement | null>;
}

export function PostExportActions({ post, articleRef }: PostExportActionsProps) {
  const [exporting, setExporting] = useState<"pdf" | "md" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExportPdf = async () => {
    const element = articleRef.current;
    if (!element) {
      setError("未找到文章内容，无法导出 PDF");
      return;
    }
    setError(null);
    setExporting("pdf");
    try {
      await exportPostPdf(element, post.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 导出失败");
    } finally {
      setExporting(null);
    }
  };

  const handleExportMd = async () => {
    setError(null);
    setExporting("md");
    try {
      await exportPostMarkdownZip(post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Markdown 导出失败");
    } finally {
      setExporting(null);
    }
  };

  const busy = exporting !== null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleExportPdf()}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex items-center gap-1 text-[var(--kp-text-2)] hover:text-[var(--kp-brand-deep)]",
          )}
          title="导出 PDF"
        >
          {exporting === "pdf" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          PDF
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleExportMd()}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex items-center gap-1 text-[var(--kp-text-2)] hover:text-[var(--kp-brand-deep)]",
          )}
          title="导出 Markdown（含图片 ZIP）"
        >
          {exporting === "md" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          MD
        </button>
        <span className="hidden items-center gap-1 text-xs text-[var(--kp-text-3)] sm:inline-flex">
          <FileText className="h-3.5 w-3.5" />
          带图
        </span>
      </div>
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
