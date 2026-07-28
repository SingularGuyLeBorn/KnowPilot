/**
 * Milkdown 编辑态链接跳转：
 * - Markdown `<a href>`（含相对 .md）→ 站内文章
 * - 字面量 [[slug]] / [[slug|标题]] → 同 WikiLink 规则
 */

import { Plugin } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";
import type { EditorView } from "@milkdown/prose/view";
import {
  isExternalHref,
  postDetailHref,
  resolvePostLinkTarget,
  type PostTreeItem,
} from "@/lib/postHref";

export type MilkdownLinkNavMeta = {
  garden?: string;
  slug?: string;
};

let navMeta: MilkdownLinkNavMeta = {};
let treeCache: { at: number; posts: PostTreeItem[] } | null = null;
const TREE_TTL_MS = 15_000;

const WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function setMilkdownLinkNavMeta(meta: MilkdownLinkNavMeta) {
  navMeta = { garden: meta.garden, slug: meta.slug };
}

async function fetchPostTree(): Promise<PostTreeItem[]> {
  const now = Date.now();
  if (treeCache && now - treeCache.at < TREE_TTL_MS) return treeCache.posts;
  const input = encodeURIComponent(JSON.stringify({ json: {} }));
  const res = await fetch(`/api/trpc/post.tree?input=${input}`);
  if (!res.ok) return treeCache?.posts ?? [];
  const json = (await res.json()) as {
    result?: { data?: { json?: PostTreeItem[] } | PostTreeItem[] };
  };
  const raw = json.result?.data;
  const posts = Array.isArray(raw) ? raw : Array.isArray(raw?.json) ? raw.json : [];
  treeCache = { at: now, posts };
  return posts;
}

function matchWikiTarget(
  posts: PostTreeItem[],
  target: string,
  preferGarden?: string,
): PostTreeItem | null {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  const pool = preferGarden
    ? [
        ...posts.filter((p) => (p.garden ?? "") === preferGarden),
        ...posts.filter((p) => (p.garden ?? "") !== preferGarden),
      ]
    : posts;
  return (
    pool.find((post) => {
      if (post.slug.toLowerCase() === normalized) return true;
      if (post.title.toLowerCase() === normalized) return true;
      if (post.slug.toLowerCase().endsWith(`/${normalized}`)) return true;
      return false;
    }) ?? null
  );
}

function goToPost(slug: string, garden?: string) {
  window.location.assign(postDetailHref(slug, garden));
}

function wikiAtOffset(text: string, offset: number): string | null {
  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (offset >= start && offset <= end) return (m[1] ?? "").trim();
  }
  return null;
}

async function navigateFromHref(href: string): Promise<boolean> {
  if (!href || href.startsWith("#")) return false;
  if (href.startsWith("wiki://")) {
    const target = decodeURIComponent(href.slice("wiki://".length));
    const posts = await fetchPostTree();
    const hit = matchWikiTarget(posts, target, navMeta.garden);
    if (!hit) return false;
    goToPost(hit.slug, hit.garden);
    return true;
  }
  if (isExternalHref(href)) return false;
  const posts = await fetchPostTree();
  const hit = resolvePostLinkTarget(href, posts, navMeta.slug, navMeta.garden);
  if (!hit) return false;
  goToPost(hit.slug, hit.garden);
  return true;
}

async function navigateFromWikiText(view: EditorView, pos: number): Promise<boolean> {
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return false;
  const target = wikiAtOffset($pos.parent.textContent, $pos.parentOffset);
  if (!target) return false;
  const posts = await fetchPostTree();
  const hit = matchWikiTarget(posts, target, navMeta.garden);
  if (!hit) return false;
  goToPost(hit.slug, hit.garden);
  return true;
}

export const milkdownLinkNav = $prose(
  () =>
    new Plugin({
      props: {
        handleClick(view, pos, event) {
          const el = event.target as HTMLElement | null;
          const a = el?.closest?.("a");
          if (!a) return false;
          const href = a.getAttribute("href") ?? "";
          if (isExternalHref(href)) {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
          event.preventDefault();
          void navigateFromHref(href).then((ok) => {
            if (!ok) void navigateFromWikiText(view, pos);
          });
          return true;
        },
        handleDOMEvents: {
          click(view, event) {
            const el = event.target as HTMLElement | null;
            if (el?.closest?.("a")) return false;
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (coords == null) return false;
            const $pos = view.state.doc.resolve(coords.pos);
            if (!$pos.parent.isTextblock) return false;
            const target = wikiAtOffset($pos.parent.textContent, $pos.parentOffset);
            if (!target) return false;
            event.preventDefault();
            void navigateFromWikiText(view, coords.pos);
            return true;
          },
        },
      },
    }),
);
