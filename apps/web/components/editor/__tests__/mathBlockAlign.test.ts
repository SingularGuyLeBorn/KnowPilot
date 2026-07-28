import { describe, expect, it } from "vitest";
import {
  parseMathBlockPayload,
  serializeMathBlockPayload,
} from "@/components/editor/mathBlockAlign";

describe("mathBlockAlign", () => {
  it("默认居中无 meta", () => {
    expect(parseMathBlockPayload("E=mc^2")).toEqual({ value: "E=mc^2", align: "center" });
    expect(serializeMathBlockPayload("E=mc^2", "center")).toBe("E=mc^2");
  });

  it("靠左写入并解析首行 meta", () => {
    const raw = serializeMathBlockPayload("a+b", "left");
    expect(raw).toBe("% kp-align: left\na+b");
    expect(parseMathBlockPayload(raw)).toEqual({ value: "a+b", align: "left" });
  });

  it("兼容无换行残留", () => {
    expect(parseMathBlockPayload("% kp-align: left\n\\frac{1}{2}")).toEqual({
      value: "\\frac{1}{2}",
      align: "left",
    });
  });
});
