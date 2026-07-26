import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { PLATFORM_CHANNELS, doctorPlatformChannels } from "../infra/platformChannels.js";

describe("platformChannels doctor", () => {
  beforeAll(async () => {
    // 确保 prisma 可连
    await prisma.$queryRaw`SELECT 1`;
  });

  it("登记表含 Inbox 主通道且 backends 有序非空", () => {
    const ids = PLATFORM_CHANNELS.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "zhihu_collections",
        "xhs_library",
        "bilibili_library",
        "wechat_links",
        "screenshot_drop",
      ]),
    );
    for (const ch of PLATFORM_CHANNELS) {
      expect(ch.backends.length).toBeGreaterThan(0);
      expect([0, 1, 2]).toContain(ch.tier);
    }
    const zhihu = PLATFORM_CHANNELS.find((c) => c.id === "zhihu_collections")!;
    expect(zhihu.backends[0]).toBe("zhihu_openapi");
  });

  it("doctor 默认非交互返回全部通道", async () => {
    const report = await doctorPlatformChannels(prisma, { liveProbe: false });
    expect(report.channels.length).toBe(PLATFORM_CHANNELS.length);
    expect(report.hint).toContain("liveProbe");
    expect(report.hint).toContain("AgentReach");
    for (const row of report.channels) {
      expect(["ok", "needs_config", "error"]).toContain(row.status);
      expect(row.backends.length).toBeGreaterThan(0);
    }
  });
});
