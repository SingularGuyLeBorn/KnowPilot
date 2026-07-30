/**
 * session_rotate 血缘链（派生视图）
 *
 * 只读拉链：沿 rotatedFromSessionId 回溯到根，再沿 rotatedToSessionId 正向铺开。
 * 图/看板 UI 只消费本模块结果，不另造协议。
 */

export type RotateLineageNode = {
  id: string;
  title: string;
  autoName?: string | null;
  agentId: string | null;
  agentName?: string | null;
  status: string;
  kind: string;
  createdAt: Date | string;
  rotatedFromSessionId: string | null;
  rotatedToSessionId: string | null;
};

export type RotateLineageResult = {
  nodes: RotateLineageNode[];
  currentIndex: number;
};

export const ROTATE_LINEAGE_MAX_NODES = 64;

type LineageRow = {
  id: string;
  title: string;
  autoName: string | null;
  agentId: string | null;
  status: string;
  kind: string;
  createdAt: Date;
  rotatedFromSessionId: string | null;
  rotatedToSessionId: string | null;
  agent: { name: string } | null;
};

function toNode(row: LineageRow): RotateLineageNode {
  return {
    id: row.id,
    title: row.title,
    autoName: row.autoName,
    agentId: row.agentId,
    agentName: row.agent?.name ?? null,
    status: row.status,
    kind: row.kind,
    createdAt: row.createdAt,
    rotatedFromSessionId: row.rotatedFromSessionId,
    rotatedToSessionId: row.rotatedToSessionId,
  };
}

/** 纯函数：给定同步取节点能力，从 seed 铺出整条 rotate 链（防环、有上限）。 */
export function walkRotateLineage(
  seedId: string,
  fetch: (id: string) => RotateLineageNode | null | undefined,
  maxNodes = ROTATE_LINEAGE_MAX_NODES,
): RotateLineageResult {
  const seen = new Set<string>();
  const back: RotateLineageNode[] = [];
  let cursor: string | null = seedId;

  while (cursor && !seen.has(cursor) && back.length < maxNodes) {
    const node = fetch(cursor);
    if (!node) break;
    seen.add(cursor);
    back.push(node);
    cursor = node.rotatedFromSessionId ?? null;
  }
  back.reverse();

  let tip = back[back.length - 1];
  while (
    tip?.rotatedToSessionId &&
    !seen.has(tip.rotatedToSessionId) &&
    back.length < maxNodes
  ) {
    const next = fetch(tip.rotatedToSessionId);
    if (!next) break;
    seen.add(next.id);
    back.push(next);
    tip = next;
  }

  const currentIndex = back.findIndex((n) => n.id === seedId);
  return {
    nodes: back,
    currentIndex: currentIndex >= 0 ? currentIndex : 0,
  };
}

/** 异步拉链：按需查库，结果可直接给 tRPC / UI。 */
export async function getRotateLineage(
  // PrismaClient 的 findUnique 返回类型随 select 变化；此处只依赖运行时 shape
  prisma: { chatSession: { findUnique: (args: any) => Promise<any> } },
  sessionId: string,
  maxNodes = ROTATE_LINEAGE_MAX_NODES,
): Promise<RotateLineageResult> {
  const cache = new Map<string, RotateLineageNode>();

  const load = async (id: string): Promise<RotateLineageNode | null> => {
    const hit = cache.get(id);
    if (hit) return hit;
    const row = await prisma.chatSession.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        autoName: true,
        agentId: true,
        status: true,
        kind: true,
        createdAt: true,
        rotatedFromSessionId: true,
        rotatedToSessionId: true,
        agent: { select: { name: true } },
      },
    });
    if (!row) return null;
    const node = toNode(row as LineageRow);
    cache.set(id, node);
    return node;
  };

  const seen = new Set<string>();
  const back: RotateLineageNode[] = [];
  let cursor: string | null = sessionId;

  while (cursor && !seen.has(cursor) && back.length < maxNodes) {
    const node = await load(cursor);
    if (!node) break;
    seen.add(cursor);
    back.push(node);
    cursor = node.rotatedFromSessionId ?? null;
  }
  back.reverse();

  let tip = back[back.length - 1];
  while (
    tip?.rotatedToSessionId &&
    !seen.has(tip.rotatedToSessionId) &&
    back.length < maxNodes
  ) {
    const next = await load(tip.rotatedToSessionId);
    if (!next) break;
    seen.add(next.id);
    back.push(next);
    tip = next;
  }

  if (back.length === 0) {
    return { nodes: [], currentIndex: 0 };
  }

  const currentIndex = back.findIndex((n) => n.id === sessionId);
  return {
    nodes: back,
    currentIndex: currentIndex >= 0 ? currentIndex : 0,
  };
}

export type RecentRotateItem = {
  id: string;
  title: string;
  autoName?: string | null;
  agentId: string | null;
  agentName?: string | null;
  status: string;
  createdAt: Date | string;
  rotatedFromSessionId: string;
  fromTitle?: string | null;
};

export type RotateGraphEdge = {
  fromId: string;
  toId: string;
};

export type RotateGraphChain = {
  /** 链根会话 id */
  rootId: string;
  /** 根→尖端有序节点 id */
  nodeIds: string[];
};

export type RotateGraphResult = {
  nodes: RotateLineageNode[];
  edges: RotateGraphEdge[];
  chains: RotateGraphChain[];
};

/**
 * 纯函数：从已加载节点派生整图（边 = rotatedFrom/To，链 = 连通分量有序路径）。
 * 管理页图/列表只读此结果，不另造边存储。
 */
export function buildRotateGraph(nodes: RotateLineageNode[]): RotateGraphResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeKey = new Set<string>();
  const edges: RotateGraphEdge[] = [];

  const pushEdge = (fromId: string, toId: string) => {
    if (!byId.has(fromId) || !byId.has(toId) || fromId === toId) return;
    const key = `${fromId}->${toId}`;
    if (edgeKey.has(key)) return;
    edgeKey.add(key);
    edges.push({ fromId, toId });
  };

  for (const n of byId.values()) {
    if (n.rotatedFromSessionId) pushEdge(n.rotatedFromSessionId, n.id);
    if (n.rotatedToSessionId) pushEdge(n.id, n.rotatedToSessionId);
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const outs = outgoing.get(e.fromId) ?? [];
    outs.push(e.toId);
    outgoing.set(e.fromId, outs);
    const ins = incoming.get(e.toId) ?? [];
    ins.push(e.fromId);
    incoming.set(e.toId, ins);
  }

  const visited = new Set<string>();
  const chains: RotateGraphChain[] = [];

  const roots = [...byId.keys()].filter((id) => !(incoming.get(id)?.length));
  // 环内节点可能无入度为 0 的根：补扫
  const startIds = roots.length > 0 ? roots : [...byId.keys()];

  for (const start of startIds) {
    if (visited.has(start)) continue;
    const nodeIds: string[] = [];
    let cursor: string | null = start;
    while (cursor && !visited.has(cursor) && byId.has(cursor)) {
      visited.add(cursor);
      nodeIds.push(cursor);
      const nexts: string[] = outgoing.get(cursor) ?? [];
      cursor = nexts.find((id: string) => !visited.has(id)) ?? null;
    }
    if (nodeIds.length > 0) {
      chains.push({ rootId: nodeIds[0]!, nodeIds });
    }
  }

  // 漏网（孤立或未从根走到的）
  for (const id of byId.keys()) {
    if (visited.has(id)) continue;
    chains.push({ rootId: id, nodeIds: [id] });
    visited.add(id);
  }

  chains.sort((a, b) => {
    const aTip = byId.get(a.nodeIds[a.nodeIds.length - 1]!);
    const bTip = byId.get(b.nodeIds[b.nodeIds.length - 1]!);
    const at = aTip?.createdAt ? new Date(aTip.createdAt).getTime() : 0;
    const bt = bTip?.createdAt ? new Date(bTip.createdAt).getTime() : 0;
    return bt - at;
  });

  return { nodes: [...byId.values()], edges, chains };
}

/** 拉取带 rotate 边的会话并派生全图（上限防炸）。 */
export async function getRotateGraph(
  prisma: {
    chatSession: {
      findMany: (args: any) => Promise<any[]>;
    };
  },
  limit = 300,
): Promise<RotateGraphResult> {
  const take = Math.min(500, Math.max(1, limit));
  const rows = (await prisma.chatSession.findMany({
    where: {
      OR: [
        { rotatedFromSessionId: { not: null } },
        { rotatedToSessionId: { not: null } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      autoName: true,
      agentId: true,
      status: true,
      kind: true,
      createdAt: true,
      rotatedFromSessionId: true,
      rotatedToSessionId: true,
      agent: { select: { name: true } },
    },
  })) as LineageRow[];

  const byId = new Map(rows.map((r) => [r.id, toNode(r)]));

  // 补齐链上被引用但不在结果集的端点（例如旧根只有被指向）
  const missing = new Set<string>();
  for (const n of byId.values()) {
    if (n.rotatedFromSessionId && !byId.has(n.rotatedFromSessionId)) {
      missing.add(n.rotatedFromSessionId);
    }
    if (n.rotatedToSessionId && !byId.has(n.rotatedToSessionId)) {
      missing.add(n.rotatedToSessionId);
    }
  }
  if (missing.size > 0) {
    const extras = (await prisma.chatSession.findMany({
      where: { id: { in: [...missing] } },
      select: {
        id: true,
        title: true,
        autoName: true,
        agentId: true,
        status: true,
        kind: true,
        createdAt: true,
        rotatedFromSessionId: true,
        rotatedToSessionId: true,
        agent: { select: { name: true } },
      },
    })) as LineageRow[];
    for (const r of extras) byId.set(r.id, toNode(r));
  }

  return buildRotateGraph([...byId.values()]);
}

/** 最近由 rotate 产生的会话（rotatedFrom 非空），供看板派生列表。 */
export async function listRecentRotates(
  prisma: { chatSession: { findMany: (args: any) => Promise<any[]> } },
  limit = 12,
): Promise<RecentRotateItem[]> {
  const take = Math.min(50, Math.max(1, limit));
  const rows = (await prisma.chatSession.findMany({
    where: { rotatedFromSessionId: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      autoName: true,
      agentId: true,
      status: true,
      createdAt: true,
      rotatedFromSessionId: true,
      agent: { select: { name: true } },
    },
  })) as Array<{
    id: string;
    title: string;
    autoName: string | null;
    agentId: string | null;
    status: string;
    createdAt: Date;
    rotatedFromSessionId: string | null;
    agent: { name: string } | null;
  }>;

  const fromIds = [
    ...new Set(
      rows
        .map((r) => r.rotatedFromSessionId)
        .filter((id): id is string => !!id),
    ),
  ];
  const fromRows =
    fromIds.length === 0
      ? []
      : ((await prisma.chatSession.findMany({
          where: { id: { in: fromIds } },
          select: { id: true, title: true, autoName: true },
        })) as Array<{ id: string; title: string; autoName: string | null }>);
  const fromMap = new Map(
    fromRows.map((r) => [r.id, r.autoName || r.title]),
  );

  const items: RecentRotateItem[] = [];
  for (const row of rows) {
    if (!row.rotatedFromSessionId) continue;
    items.push({
      id: row.id,
      title: row.title,
      autoName: row.autoName,
      agentId: row.agentId,
      agentName: row.agent?.name ?? null,
      status: row.status,
      createdAt: row.createdAt,
      rotatedFromSessionId: row.rotatedFromSessionId,
      fromTitle: fromMap.get(row.rotatedFromSessionId) ?? null,
    });
  }
  return items;
}
