import { describe, expect, it } from "vitest";
import {
  formatContextPill,
  formatModalityLabel,
  formatPublisherLabel,
  freeModelsMessages,
} from "../freeModelsI18n";

describe("freeModelsI18n pills", () => {
  it("Free / ctx / 厂商标签随语言切换", () => {
    expect(freeModelsMessages("zh").freeBadge).toBe("免费");
    expect(freeModelsMessages("en").freeBadge).toBe("Free");
    expect(formatContextPill(1_000_000, "zh", () => "1.0M")).toBe("1.0M 上下文");
    expect(formatContextPill(1_000_000, "en", () => "1.0M")).toBe("1.0M ctx");
    expect(formatPublisherLabel("nvidia", "zh")).toBe("英伟达");
    expect(formatPublisherLabel("nvidia", "en")).toBe("NVIDIA");
    expect(formatPublisherLabel("unknown-slug", "zh")).toBe("unknown-slug");
  });

  it("模态 text→text 随语言切换", () => {
    expect(formatModalityLabel("text->text", "zh")).toBe("文本→文本");
    expect(formatModalityLabel("text->text", "en")).toBe("text→text");
  });
});
