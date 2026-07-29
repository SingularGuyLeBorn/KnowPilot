import { describe, expect, it } from "vitest";
import {
  parseBoardDoc,
  serializeBoardDoc,
  type BoardDoc,
} from "@/components/editor/BoardCanvas";

describe("BoardCanvas parse/serialize", () => {
  it("兼容 v1 width + xy 点列", () => {
    const raw = JSON.stringify({
      v: 1,
      w: 720,
      h: 360,
      strokes: [{ color: "currentColor", width: 2.5, points: [10, 20, 30, 40] }],
    });
    const doc = parseBoardDoc(raw);
    expect(doc.v).toBe(2);
    expect(doc.strokes).toHaveLength(1);
    expect(doc.strokes[0]!.points).toEqual([10, 20, 0.5, 30, 40, 0.5]);
    expect(doc.strokes[0]!.size).toBeGreaterThan(2);
    expect(doc.strokes[0]!.color).toBe("#1c1917");
  });

  it("往返序列化保留压感点", () => {
    const doc: BoardDoc = {
      v: 2,
      w: 960,
      h: 540,
      strokes: [
        {
          color: "#b91c1c",
          size: 8,
          tool: "pen",
          points: [1, 2, 0.4, 5, 6, 0.9],
        },
      ],
    };
    const again = parseBoardDoc(serializeBoardDoc(doc));
    expect(again.strokes[0]).toEqual(doc.strokes[0]);
  });
});
