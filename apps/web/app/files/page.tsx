/**
 * Files 文件管理页面 (L3 系统与运维 & L1 图片上传基建)
 *
 * 支持将本地图片、附件等上传至 content/uploads/ 存储。
 * 实装了 Base64 转换并调用 file.upload tRPC mutation 上传的完整链路。
 */

"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Files, Upload, Link, Database } from "lucide-react";
import type { FileMeta } from "@knowpilot/shared";
import { useFile, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";

export default function FilesPage() {
  const { useList, useDelete, useUpload } = useFile();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const deleteMutation = useDelete();
  const uploadMutation = useUpload();
  
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 文件转换为 Base64 并上传
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64Data = (reader.result as string).split(",")[1];
      if (base64Data) {
        uploadMutation.mutate({
          name: file.name,
          mimeType: file.type,
          size: file.size,
          data: base64Data,
        });
      }
    };
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  // 格式化文件大小
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-6">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,.pdf,.zip,.txt"
      />

      <PageHeader
        icon={Files}
        title="资源与文件柜"
        description="为文章提供图片、图表或代码附件的集中托管。在这里上传的资源会被自动放置在本地上传文件夹，直接通过相对 URL 在 Markdown 中渲染引用。"
        action={{ label: uploadMutation.isPending ? "正在存盘..." : "上传本地资源", onClick: triggerUpload, icon: Upload, disabled: uploadMutation.isPending }}
        showDensityToggle
      />

      {/* 数据列表 */}
      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="文件柜空置"
          description="没有上传过任何附件或图片资源。点击按钮立即上传您的第一张 Markdown 贴图。"
          actionLabel="上传示例文件"
          onAction={triggerUpload}
        />
      ) : (
        <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 ", density === "compact" ? "gap-4" : "gap-6")}>
          {data.items.map((file: FileMeta, idx: number) => {
            const isImage = file.mimeType.startsWith("image/");
            return (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ 
                  opacity: 1, 
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 }
                }}
                className={cn("group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 hover:bg-white dark:hover:bg-[var(--vp-c-bg-soft)] hover:border-[var(--vp-c-divider)] hover:shadow-xl transition-all duration-300 flex flex-col justify-between", density === "compact" ? "p-2.5" : "p-4")}
              >
                {/* 预览区域 */}
                <div className="aspect-video w-full rounded-xl bg-[var(--vp-c-bg-soft)] overflow-hidden mb-3 relative flex items-center justify-center border border-[var(--vp-c-divider-light)]">
                  {isImage ? (
                    <Image
                      src={file.url}
                      alt={file.name}
                      fill
                      unoptimized
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <Database className="w-8 h-8 text-[var(--vp-c-text-3)]" />
                  )}
                  
                  <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`![${file.name}](${file.url})`);
                        alert("Markdown 链接已复制！");
                      }}
                      className="bg-black/60 hover:bg-black/80 text-white text-[10px] p-1.5 rounded-lg backdrop-blur-sm"
                      title="复制 MD 链接"
                    >
                      <Link className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-[var(--vp-c-text-1)] text-xs truncate" title={file.name}>
                    {file.name}
                  </h3>
                  <div className="flex justify-between items-center text-[10px] text-[var(--vp-c-text-3)] mt-1.5">
                    <span>{formatBytes(file.size)}</span>
                    <span>{file.mimeType.split("/")[1]?.toUpperCase()}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center border-t border-[var(--vp-c-divider-light)] mt-3 pt-3">
                  <span className="text-[10px] text-[var(--vp-c-text-3)]">
                    {new Date(file.createdAt).toLocaleDateString()}
                  </span>
                  
                  <button
                    onClick={() => setDeleteId(file.id)}
                    className="text-red-500 hover:text-red-600 text-[10px] font-medium"
                  >
                    删除
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="删除资源文件"
        description="确定要彻底删除该文件资源吗？这会导致引用该资源的 Markdown 页面图片失效破损。"
        isDestructive={true}
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
