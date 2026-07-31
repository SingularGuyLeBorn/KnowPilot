"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { debounce } from "lodash-es";
import { trpc } from "./trpc";

interface AutoSavePayload {
  title: string;
  content: string;
  category: string;
  tags: string;
  published: boolean;
}

interface UseAutoSaveOptions {
  id?: string;
  title: string;
  content: string;
  category: string;
  tags: string;
  published: boolean;
  enabled: boolean;
  onRestored?: (draft: AutoSavePayload) => void;
}

function draftKey(id?: string) {
  return id ? `kp:draft:${id}` : "kp:draft:new";
}

/**
 * 自动保存链路：
 * 1) 改动后 2s debounce → localStorage 备份
 * 2) 已有 id 时同时 post.update → 服务端 FileSync 写回 content/{garden}/{slug}.md
 * 3) Markdown 在 Git 跟踪目录里，落盘后会出现在 git status（需你手动 commit）
 * Ctrl+S 走 saveNow：立刻 flush，不等 debounce。
 */
export function useAutoSave({
  id,
  title,
  content,
  category,
  tags,
  published,
  enabled,
  onRestored,
}: UseAutoSaveOptions) {
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const updatePost = trpc.post.update.useMutation();
  const skipFirstRef = useRef(true);
  const latestRef = useRef({ id, title, content, category, tags, published });
  /** 上次成功落库的快照；未变则跳过 post.update，避免无意义 writeFile → chokidar 风暴 */
  const lastFlushedRef = useRef<string | null>(null);

  useEffect(() => {
    latestRef.current = { id, title, content, category, tags, published };
  }, [id, title, content, category, tags, published]);

  useEffect(() => {
    lastFlushedRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!enabled) return;
    if (id) return;
    try {
      const raw = localStorage.getItem(draftKey(id));
      if (raw) {
        const draft: AutoSavePayload = JSON.parse(raw);
        onRestored?.(draft);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id]);

  const flushSave = useCallback(async () => {
    const payload = latestRef.current;
    try {
      localStorage.setItem(
        draftKey(payload.id),
        JSON.stringify({
          title: payload.title,
          content: payload.content,
          category: payload.category,
          tags: payload.tags,
          published: payload.published,
        }),
      );
    } catch {
      // ignore
    }
    if (!payload.id) {
      setLastSavedAt(new Date());
      return;
    }
    const tagsNorm = payload.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const snapshot = JSON.stringify({
      title: payload.title.trim(),
      content: payload.content,
      category: payload.category || null,
      tags: tagsNorm,
      published: payload.published,
    });
    if (lastFlushedRef.current === snapshot) {
      setLastSavedAt(new Date());
      return;
    }
    setIsSaving(true);
    try {
      const result = await updatePost.mutateAsync({
        id: payload.id,
        title: payload.title.trim(),
        content: payload.content,
        category: payload.category || null,
        tags: tagsNorm,
        published: payload.published,
      });
      if (result.success) {
        lastFlushedRef.current = snapshot;
        setLastSavedAt(new Date());
      } else console.error("保存失败:", result.error);
    } catch (err) {
      console.error("保存失败:", err);
    } finally {
      setIsSaving(false);
    }
  }, [updatePost]);

  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    debouncedSaveRef.current = debounce(() => {
      flushSave().catch(() => {});
    }, 2000);
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, [flushSave]);

  useEffect(() => {
    if (!enabled) return;
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    debouncedSaveRef.current?.();
  }, [enabled, title, content, category, tags, published]);

  useEffect(() => {
    return () => {
      debouncedSaveRef.current?.flush();
    };
  }, []);

  const saveNow = useCallback(async () => {
    debouncedSaveRef.current?.cancel();
    await flushSave();
  }, [flushSave]);

  return { lastSavedAt, isSaving, saveNow };
}
