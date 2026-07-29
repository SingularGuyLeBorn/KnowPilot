"use client";

import { useCallback, useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export type UploadedImage = {
  url: string;
  alt: string;
};

export type ImageUploadMeta = {
  garden?: string;
  slug?: string;
};

interface ImageUploadButtonProps {
  onUploaded: (image: UploadedImage) => void;
  /** 文章元信息 → uploads/{garden}/{slug}/ */
  meta?: ImageUploadMeta;
  /**
   * 若返回 true，表示已由调用方处理（如 WYSIWYG 占位上传），跳过内部 upload。
   */
  interceptFile?: (file: File) => boolean;
  className?: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function imageToMarkdown(image: UploadedImage): string {
  return `\n![${image.alt}](${image.url})\n`;
}

export async function uploadImageFile(
  file: File,
  upload: {
    mutateAsync: (input: {
      name: string;
      mimeType: string;
      size: number;
      data: string;
      garden?: string;
      slug?: string;
    }) => Promise<{ success: boolean; data?: { url?: string }; error?: { message?: string } }>;
  },
  meta?: ImageUploadMeta,
): Promise<UploadedImage | null> {
  if (!file.type.startsWith("image/")) {
    alert("仅支持上传图片文件");
    return null;
  }
  const data = await fileToBase64(file);
  const result = await upload.mutateAsync({
    name: file.name,
    mimeType: file.type,
    size: file.size,
    data,
    garden: meta?.garden,
    slug: meta?.slug || (meta?.garden ? "_draft" : undefined),
  });
  if (result.success && result.data?.url) {
    const alt = file.name.replace(/\.[^/.]+$/, "");
    return { url: result.data.url, alt };
  }
  alert(`上传失败：${result.error?.message || "未知错误"}`);
  return null;
}

export function normalizePasteImageFile(file: File): File {
  if (file.name && file.name !== "image.png") return file;
  const ext = file.type.split("/")[1] || "png";
  return new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
}

/** 供 Milkdown / 源码模式共用的上传 hook */
export function useImageUploader(meta?: ImageUploadMeta) {
  const { mutateAsync } = trpc.file.upload.useMutation();
  const [uploading, setUploading] = useState(false);
  const garden = meta?.garden;
  const slug = meta?.slug;

  const upload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      setUploading(true);
      try {
        return await uploadImageFile(file, { mutateAsync }, { garden, slug });
      } catch (err) {
        alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setUploading(false);
      }
    },
    [mutateAsync, garden, slug],
  );

  return { upload, uploading };
}

export function ImageUploadButton({
  onUploaded,
  meta,
  interceptFile,
  className,
}: ImageUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useImageUploader(meta);

  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    if (interceptFile?.(file)) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const image = await upload(file);
    if (image) onUploaded(image);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFileSelect(e.target.files?.[0]).catch(() => {});
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "inline-flex items-center gap-1 text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]",
          className,
        )}
        title="上传图片（Ctrl+V 粘贴 / 拖放；按花园·文章分目录）"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        {uploading ? "上传中…" : "图片"}
      </button>
    </>
  );
}

export function useImageDrop(
  onUploaded: (image: UploadedImage) => void,
  meta?: ImageUploadMeta,
) {
  const [dragOver, setDragOver] = useState(false);
  const { upload } = useImageUploader(meta);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;

    const image = await upload(file);
    if (image) onUploaded(image);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  return {
    dragOver,
    dropHandlers: {
      onDrop: handleDrop,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
    },
  };
}

/** 粘贴剪贴板图片并上传（源码 textarea / 外层容器用） */
export function useImagePaste(
  onUploaded: (image: UploadedImage) => void,
  meta?: ImageUploadMeta,
) {
  const { upload } = useImageUploader(meta);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;

    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    const image = await upload(normalizePasteImageFile(file));
    if (image) onUploaded(image);
  };

  return { onPaste: handlePaste };
}
