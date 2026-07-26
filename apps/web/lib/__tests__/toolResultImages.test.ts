import { describe, expect, it } from "vitest";
import { extractToolResultImages, resolveUploadPublicUrl } from "../toolResultImages";

describe("resolveUploadPublicUrl", () => {
  it("规范化 uploads 路径", () => {
    expect(resolveUploadPublicUrl("/uploads/screenshots/a.png")).toBe("/uploads/screenshots/a.png");
    expect(resolveUploadPublicUrl("content/uploads/screenshots/a.png")).toBe(
      "/uploads/screenshots/a.png",
    );
    expect(resolveUploadPublicUrl("uploads/screenshots/a.png")).toBe("/uploads/screenshots/a.png");
    expect(resolveUploadPublicUrl("content\\uploads\\screenshots\\a.png")).toBe(
      "/uploads/screenshots/a.png",
    );
  });

  it("非图片路径返回 null", () => {
    expect(resolveUploadPublicUrl("data/workspace/x.txt")).toBeNull();
  });
});

describe("extractToolResultImages", () => {
  it("browser_screenshot 结果", () => {
    const imgs = extractToolResultImages({
      publicUrl: "/uploads/screenshots/x.png",
      path: "content/uploads/screenshots/x.png",
      title: "示例页",
    });
    expect(imgs).toEqual([{ src: "/uploads/screenshots/x.png", label: "示例页" }]);
  });

  it("scroll_screenshot 多图", () => {
    const imgs = extractToolResultImages({
      screenshots: [
        { publicUrl: "/uploads/screenshots/a-s0.png", step: 0 },
        { path: "content/uploads/screenshots/a-s1.png", step: 1 },
      ],
    });
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toEqual({ src: "/uploads/screenshots/a-s0.png", label: "第 1 屏" });
    expect(imgs[1]).toEqual({ src: "/uploads/screenshots/a-s1.png", label: "第 2 屏" });
  });

  it("无图结果返回空", () => {
    expect(extractToolResultImages({ url: "https://example.com", title: "x" })).toEqual([]);
    expect(extractToolResultImages(null)).toEqual([]);
  });
});
