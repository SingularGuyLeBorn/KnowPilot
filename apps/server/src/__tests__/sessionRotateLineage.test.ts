import { describe, expect, it } from "vitest";
import {
  walkRotateLineage,
  buildRotateGraph,
  type RotateLineageNode,
} from "../infra/sessionRotateLineage.js";

function node(
  partial: Pick<RotateLineageNode, "id"> &
    Partial<Omit<RotateLineageNode, "id">>,
): RotateLineageNode {
  return {
    title: partial.title ?? partial.id,
    agentId: null,
    status: "active",
    kind: "chat",
    createdAt: new Date("2026-01-01"),
    rotatedFromSessionId: null,
    rotatedToSessionId: null,
    ...partial,
  };
}

describe("walkRotateLineage", () => {
  it("单节点无血缘", () => {
    const map = new Map([["a", node({ id: "a" })]]);
    const result = walkRotateLineage("a", (id) => map.get(id));
    expect(result.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(result.currentIndex).toBe(0);
  });

  it("从中段拉链得到完整 A→B→C", () => {
    const map = new Map([
      [
        "a",
        node({ id: "a", title: "A", rotatedToSessionId: "b" }),
      ],
      [
        "b",
        node({
          id: "b",
          title: "B",
          rotatedFromSessionId: "a",
          rotatedToSessionId: "c",
        }),
      ],
      [
        "c",
        node({ id: "c", title: "C", rotatedFromSessionId: "b" }),
      ],
    ]);
    const fromB = walkRotateLineage("b", (id) => map.get(id));
    expect(fromB.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(fromB.currentIndex).toBe(1);

    const fromC = walkRotateLineage("c", (id) => map.get(id));
    expect(fromC.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(fromC.currentIndex).toBe(2);
  });

  it("环边被 seen 截断，不无限循环", () => {
    const map = new Map([
      [
        "a",
        node({
          id: "a",
          rotatedFromSessionId: "b",
          rotatedToSessionId: "b",
        }),
      ],
      [
        "b",
        node({
          id: "b",
          rotatedFromSessionId: "a",
          rotatedToSessionId: "a",
        }),
      ],
    ]);
    const result = walkRotateLineage("a", (id) => map.get(id));
    expect(result.nodes.length).toBeLessThanOrEqual(2);
    expect(new Set(result.nodes.map((n) => n.id)).size).toBe(result.nodes.length);
  });

  it("缺失节点时停在已加载前缀", () => {
    const map = new Map([
      ["b", node({ id: "b", rotatedFromSessionId: "missing" })],
    ]);
    const result = walkRotateLineage("b", (id) => map.get(id));
    expect(result.nodes.map((n) => n.id)).toEqual(["b"]);
  });
});

describe("buildRotateGraph", () => {
  it("从双向边字段派生两条链与边", () => {
    const nodes = [
      node({
        id: "a",
        title: "A",
        rotatedToSessionId: "b",
        createdAt: new Date("2026-01-01"),
      }),
      node({
        id: "b",
        title: "B",
        rotatedFromSessionId: "a",
        rotatedToSessionId: "c",
        createdAt: new Date("2026-01-02"),
      }),
      node({
        id: "c",
        title: "C",
        rotatedFromSessionId: "b",
        createdAt: new Date("2026-01-03"),
      }),
      node({
        id: "x",
        title: "X",
        rotatedToSessionId: "y",
        createdAt: new Date("2026-02-01"),
      }),
      node({
        id: "y",
        title: "Y",
        rotatedFromSessionId: "x",
        createdAt: new Date("2026-02-02"),
      }),
    ];
    const graph = buildRotateGraph(nodes);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
        { fromId: "x", toId: "y" },
      ]),
    );
    expect(graph.edges).toHaveLength(3);
    const chains = graph.chains.map((c) => c.nodeIds.join(">")).sort();
    expect(chains).toEqual(["a>b>c", "x>y"].sort());
  });

  it("缺一端节点时不造悬空边", () => {
    const graph = buildRotateGraph([
      node({ id: "b", rotatedFromSessionId: "ghost", rotatedToSessionId: "ghost2" }),
    ]);
    expect(graph.edges).toEqual([]);
    expect(graph.chains).toEqual([{ rootId: "b", nodeIds: ["b"] }]);
  });
});
