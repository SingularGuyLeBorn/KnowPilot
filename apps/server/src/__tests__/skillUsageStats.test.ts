import { describe, it, expect, vi } from "vitest";
import {
  mergeSkillUsageStats,
  parseSkillUsageStats,
  executeSkill,
} from "../infra/skillRunner.js";
import { makeSkillEntity } from "./helpers/toolTestFixtures.js";

describe("Skill usage stats（Hermes discover 账本）", () => {
  it("mergeSkillUsageStats 累加成功/失败并算 successRate", () => {
    const a = mergeSkillUsageStats(null, true, new Date("2026-07-18T00:00:00.000Z"));
    expect(a.stats).toMatchObject({
      usageCount: 1,
      successCount: 1,
      failCount: 0,
      successRate: 100,
    });
    const b = mergeSkillUsageStats(a.metaJson, false, new Date("2026-07-18T01:00:00.000Z"));
    expect(b.stats).toMatchObject({
      usageCount: 2,
      successCount: 1,
      failCount: 1,
      successRate: 50,
    });
  });

  it("parseSkillUsageStats 无 stats 或 usageCount=0 返回 null（防假繁荣）", () => {
    expect(parseSkillUsageStats(null)).toBeNull();
    expect(parseSkillUsageStats("{}")).toBeNull();
    expect(parseSkillUsageStats(JSON.stringify({ stats: { usageCount: 0, successRate: 100 } }))).toBeNull();
    expect(
      parseSkillUsageStats(
        JSON.stringify({ stats: { usageCount: 3, successCount: 3, failCount: 0, successRate: 100 } }),
      ),
    ).toMatchObject({ usageCount: 3, successRate: 100 });
  });

  it("executeSkill 成功后回写 skill.update(metaJson.stats)", async () => {
    const skill = makeSkillEntity({
      id: "sk-1",
      name: "calc",
      code: `function run(input) { return input.length; }`,
      metaJson: null,
    });
    const update = vi.fn(async () => ({ success: true, data: skill }));
    const services = {
      skill: {
        list: vi.fn(async () => ({
          items: [skill],
          total: 1,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        })),
        update,
      },
    };
    const result = await executeSkill(services as never, "calc", { input: "hi" });
    expect((result as { result: number }).result).toBe(2);
    expect(update).toHaveBeenCalledOnce();
    const arg = (update.mock.calls as unknown as Array<[{ id: string; metaJson: string }]>)[0]![0]!;
    expect(arg.id).toBe("sk-1");
    const stats = parseSkillUsageStats(arg.metaJson);
    expect(stats).toMatchObject({ usageCount: 1, successCount: 1, successRate: 100 });
  });

  it("executeSkill 沙箱失败记 failCount", async () => {
    const skill = makeSkillEntity({
      id: "sk-bad",
      name: "bad",
      code: `function run() { throw new Error("boom"); }`,
    });
    const update = vi.fn(async () => ({ success: true, data: skill }));
    const services = {
      skill: {
        list: vi.fn(async () => ({
          items: [skill],
          total: 1,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        })),
        update,
      },
    };
    const result = (await executeSkill(services as never, "bad", { input: "x" })) as { error: string };
    expect(result.error).toMatch(/boom/);
    const stats = parseSkillUsageStats(
      (update.mock.calls as unknown as Array<[{ metaJson: string }]>)[0]![0]!.metaJson,
    );
    expect(stats).toMatchObject({ usageCount: 1, successCount: 0, failCount: 1, successRate: 0 });
  });
});
