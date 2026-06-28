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

  // Restore local draft once on mount (only for new posts or when explicitly requested)
  useEffect(() => {
    if (!enabled) return;
    if (id) return; // do not override server content for existing posts
    try {
      const raw = localStorage.getItem(draftKey(id));
      if (raw) {
        const draft: AutoSavePayload = JSON.parse(raw);
        onRestored?.(draft);
      }
    } catch {
      // ignore corrupted draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id]);

  const saveToStorage = useCallback(
    (payload: AutoSavePayload) => {
      try {
        localStorage.setItem(draftKey(id), JSON.stringify(payload));
        setLastSavedAt(new Date());
      } catch {
        // storage might be full
      }
    },
    [id]
  );

  const saveToServer = useCallback(
    (payload: AutoSavePayload) => {
      if (!id) return;
      setIsSaving(true);
      updatePost.mutate(
        {
          id,
          title: payload.title.trim(),
          content: payload.content,
          category: payload.category || null,
          tags: payload.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          published: payload.published,
        },
        {
          onSettled: () => setIsSaving(false),
        }
      );
    },
    [id, updatePost]
  );

  const debouncedSave = useRef(
    debounce((payload: AutoSavePayload) => {
      saveToStorage(payload);
      saveToServer(payload);
    }, 2000)
  );

  useEffect(() => {
    if (!enabled) return;
    const payload: AutoSavePayload = { title, content, category, tags, published };
    debouncedSave.current(payload);
  }, [enabled, title, content, category, tags, published]);

  useEffect(() => {
    return () => {
      debouncedSave.current.flush();
    };
  }, []);

  return { lastSavedAt, isSaving };
}
