/**
 * 会话树 UI 纯函数：分支指示 / 书签列表 / 摘要卡判定
 */

export type TreeChildrenMap = Record<string, string[]>;

/** 某节点（不含 branch_summary）的兄弟分支数 */
export function countBranches(
  children: TreeChildrenMap,
  messageId: string,
  nodeKinds?: Record<string, string | null | undefined>,
): number {
  const kids = children[messageId] ?? [];
  if (!nodeKinds) return kids.length;
  return kids.filter((id) => nodeKinds[id] !== "branch_summary").length;
}

export function branchIndicatorLabel(branchCount: number): string | null {
  if (branchCount < 2) return null;
  return `${branchCount} 个分支`;
}

export function isBranchSummaryMessage(msg: { kind?: string | null; content?: string }): boolean {
  return msg.kind === "branch_summary" || (msg.content?.includes("[kp-branch-summary]") ?? false);
}

export type BookmarkEntry = { id: string; label: string; contentPreview: string };

export function collectBookmarks(
  messages: Array<{ id: string; label?: string | null; content: string }>,
): BookmarkEntry[] {
  return messages
    .filter((m) => typeof m.label === "string" && m.label.trim().length > 0)
    .map((m) => ({
      id: m.id,
      label: m.label!.trim(),
      contentPreview: m.content.slice(0, 80),
    }));
}

/** 从邻接表取某节点的非摘要子节点（供切换菜单） */
export function listBranchChildren(
  children: TreeChildrenMap,
  messageId: string,
  nodes: Array<{ id: string; kind?: string | null; contentPreview: string; role: string }>,
): Array<{ id: string; preview: string; role: string }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (children[messageId] ?? [])
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.kind !== "branch_summary")
    .map((n) => ({ id: n.id, preview: n.contentPreview, role: n.role }));
}
