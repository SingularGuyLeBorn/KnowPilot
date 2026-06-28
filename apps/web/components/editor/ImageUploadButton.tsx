"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface ImageUploadButtonProps {
  onUploaded: (markdown: string) => void;
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

async function uploadImageFile(
  file: File,
  upload: ReturnType<typeof trpc.file.upload.useMutation>,
): Promise<string | null> {
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
  });
  if (result.success && result.data?.url) {
    const alt = file.name.replace(/\.[^/.]+$/, "");
    return `\n![${alt}](${result.data.url})\n`;
  }
  alert(`上传失败：${result.error?.message || "未知错误"}`);
  return null;
}

export function ImageUploadButton({ onUploaded, className }: ImageUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadFile = trpc.file.upload.useMutation();

  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const markdown = await uploadImageFile(file, uploadFile);
      if (markdown) onUploaded(markdown);
    } catch (err) {
      alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "inline-flex items-center gap-1 text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]",
          className
        )}
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        {uploading ? "上传中…" : "图片"}
      </button>
    </>
  );
}

export function useImageDrop(onUploaded: (markdown: string) => void) {
  const [dragOver, setDragOver] = useState(false);
  const uploadFile = trpc.file.upload.useMutation();

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;

    try {
      const markdown = await uploadImageFile(file, uploadFile);
      if (markdown) onUploaded(markdown);
    } catch (err) {
      alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
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

/** 粘贴剪贴板图片并上传 */
export function useImagePaste(onUploaded: (markdown: string) => void) {
  const uploadFile = trpc.file.upload.useMutation();

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;

    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    try {
      const ext = file.type.split("/")[1] || "png";
      const named = file.name && file.name !== "image.png" ? file : new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
      const markdown = await uploadImageFile(named, uploadFile);
      if (markdown) onUploaded(markdown);
    } catch (err) {
      alert(`粘贴上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return { onPaste: handlePaste };
}
