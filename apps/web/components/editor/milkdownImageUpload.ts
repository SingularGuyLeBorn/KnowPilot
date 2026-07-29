/**
 * Milkdown 图片粘贴 / 拖放：
 * 1) 立刻插入 blob 占位图（Notion UX）
 * 2) file.upload 成功后替换为 /uploads/{garden}/{postId|/_draft/draftKey}/…
 */

import { imageSchema } from "@milkdown/preset-commonmark";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { Node as PmNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";

export type MilkdownImageUploadResult = {
  src: string;
  alt?: string;
  title?: string;
};

export type MilkdownImageUploader = (
  file: File,
) => Promise<MilkdownImageUploadResult | null>;

const UPLOADING_TITLE_PREFIX = "kp-uploading:";

let uploader: MilkdownImageUploader | null = null;
let activeView: EditorView | null = null;
let imageNodeType: ReturnType<typeof imageSchema.type> | null = null;

export function setMilkdownImageUploader(fn: MilkdownImageUploader | null) {
  uploader = fn;
}

export function insertMilkdownImageAtCursor(
  attrs: MilkdownImageUploadResult,
): boolean {
  const view = activeView;
  const type = imageNodeType;
  if (!view || !type) return false;
  const node = type.create({
    src: attrs.src,
    alt: attrs.alt ?? "",
    title: attrs.title ?? "",
  });
  if (!node) return false;
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
  return true;
}

/** 工具栏选文件：与粘贴同一套占位 → 上传 → 替换 */
export function beginMilkdownImageUpload(file: File): boolean {
  const view = activeView;
  if (!view || !uploader || !imageNodeType) return false;
  uploadAndInsertWithPlaceholder(view, file).catch((err) => {
    console.error("[milkdownImageUpload] begin failed", err);
  });
  return true;
}

function pickImageFile(files: FileList | File[] | null | undefined): File | null {
  if (!files) return null;
  return Array.from(files).find((f) => f.type.startsWith("image/")) ?? null;
}

function normalizePasteFile(file: File): File {
  if (file.name && file.name !== "image.png") return file;
  const ext = file.type.split("/")[1] || "png";
  return new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
}

function findImagePosByTitle(doc: PmNode, title: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name === "image" && node.attrs.title === title) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

async function uploadAndInsertWithPlaceholder(view: EditorView, file: File) {
  if (!uploader || !imageNodeType) return;

  const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const title = `${UPLOADING_TITLE_PREFIX}${token}`;
  const blobUrl = URL.createObjectURL(file);
  const altBase = file.name.replace(/\.[^/.]+$/, "") || "image";
  const placeholder = imageNodeType.create({
    src: blobUrl,
    alt: `上传中… ${altBase}`,
    title,
  });

  const target = activeView ?? view;
  target.dispatch(target.state.tr.replaceSelectionWith(placeholder).scrollIntoView());
  target.focus();

  try {
    const result = await uploader(file);
    const live = activeView ?? target;
    const pos = findImagePosByTitle(live.state.doc, title);
    if (pos == null) {
      URL.revokeObjectURL(blobUrl);
      return;
    }
    if (!result) {
      live.dispatch(live.state.tr.delete(pos, pos + 1).scrollIntoView());
      URL.revokeObjectURL(blobUrl);
      return;
    }
    live.dispatch(
      live.state.tr
        .setNodeMarkup(pos, undefined, {
          src: result.src,
          alt: result.alt ?? altBase,
          title: result.title ?? "",
        })
        .scrollIntoView(),
    );
    URL.revokeObjectURL(blobUrl);
    live.focus();
  } catch (err) {
    const live = activeView ?? target;
    const pos = findImagePosByTitle(live.state.doc, title);
    if (pos != null) {
      live.dispatch(live.state.tr.delete(pos, pos + 1));
    }
    URL.revokeObjectURL(blobUrl);
    throw err;
  }
}

export const milkdownImageUpload = $prose((ctx) => {
  imageNodeType = imageSchema.type(ctx);

  return new Plugin({
    key: new PluginKey("kp-milkdown-image-upload"),
    view(editorView) {
      activeView = editorView;
      return {
        destroy() {
          if (activeView === editorView) activeView = null;
        },
      };
    },
    props: {
      handlePaste(view, event) {
        if (!uploader) return false;
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((item) => item.type.startsWith("image/"));
        if (!imageItem) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        event.preventDefault();
        uploadAndInsertWithPlaceholder(view, normalizePasteFile(file)).catch((err) => {
          console.error("[milkdownImageUpload] paste failed", err);
        });
        return true;
      },
      handleDrop(view, event) {
        if (!uploader) return false;
        const file = pickImageFile(event.dataTransfer?.files);
        if (!file) return false;
        event.preventDefault();
        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords);
        if (pos != null) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.pos)),
          );
        }
        uploadAndInsertWithPlaceholder(view, file).catch((err) => {
          console.error("[milkdownImageUpload] drop failed", err);
        });
        return true;
      },
    },
  });
});
