import { describe, expect, it } from "vitest";
import { describeCron, describeCronOption } from "../cronDescribe";

describe("describeCron", () => {
  it("预设与每天整点", () => {
    expect(describeCron("0 9 * * *")).toBe("每天 9:00");
    expect(describeCron("0 10 * * *")).toBe("每天 10:00");
    expect(describeCron("0 0 * * *")).toBe("每天 0:00");
  });

  it("间隔与每周", () => {
    expect(describeCron("*/30 * * * *")).toBe("每 30 分钟");
    expect(describeCron("0 */6 * * *")).toBe("每 6 小时");
    expect(describeCron("0 9 * * 1")).toBe("每周一 9:00");
  });

  it("自定义下拉带中文 + cron", () => {
    expect(describeCronOption("0 10 * * *")).toBe("自定义 · 每天 10:00（0 10 * * *）");
  });
});
