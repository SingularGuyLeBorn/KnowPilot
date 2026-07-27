import { describe, expect, it } from "vitest";
import { extractPinmePublicUrl } from "../infra/tools/native/deploy.js";

describe("extractPinmePublicUrl", () => {
  it("优先非 preview URL", () => {
    const out = `
uploading...
https://pinme.eth.limo/#/preview/QmHashPreview
Done: https://demo.pinit.eth.limo
`;
    expect(extractPinmePublicUrl(out)).toBe("https://demo.pinit.eth.limo");
  });

  it("仅有 preview 时回退", () => {
    const out = "ok https://pinme.eth.limo/#/preview/abc123";
    expect(extractPinmePublicUrl(out)).toContain("preview");
  });

  it("无 URL 返回 null", () => {
    expect(extractPinmePublicUrl("failed auth")).toBeNull();
  });
});
