import { describe, expect, it } from "vitest";
import { probeImageSize } from "../infra/imageProbe.js";

function png(w: number, h: number): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // IHDR length/type skipped — probe reads width/height at 16/20
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

describe("probeImageSize", () => {
  it("读 PNG 宽高", () => {
    expect(probeImageSize(png(1280, 720))).toEqual({ width: 1280, height: 720, kind: "png" });
  });

  it("读 GIF 宽高", () => {
    const buf = Buffer.alloc(16);
    buf.write("GIF89a", 0);
    buf.writeUInt16LE(320, 6);
    buf.writeUInt16LE(240, 8);
    expect(probeImageSize(buf)).toEqual({ width: 320, height: 240, kind: "gif" });
  });

  it("非图片返回 null", () => {
    expect(probeImageSize(Buffer.from("hello world!!!!!!!!!!"))).toBeNull();
  });
});
