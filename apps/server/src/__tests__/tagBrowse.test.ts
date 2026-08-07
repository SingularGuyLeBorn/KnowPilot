import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import { browseByTag, collectTagFacets } from "../infra/tagBrowse.js";

describe("tagBrowse", () => {
  const stamp = `tag-browse-${Date.now()}`;
  let skillId = "";
  let memoryId = "";

  beforeAll(async () => {
    const skill = await prisma.skill.create({
      data: {
        name: `${stamp}-skill`,
        description: "tag browse test",
        code: "# test",
        enabled: true,
        tags: "非常有用,Harness",
      },
    });
    skillId = skill.id;
    const mem = await prisma.memory.create({
      data: {
        content: `${stamp} memory about harness`,
        type: "note",
        strength: 0.5,
        keywords: "harness",
        tags: "非常有用",
        status: "active",
        scope: "global",
      },
    });
    memoryId = mem.id;
  });

  afterAll(async () => {
    if (skillId) await prisma.skill.delete({ where: { id: skillId } }).catch(() => {});
    if (memoryId) await prisma.memory.delete({ where: { id: memoryId } }).catch(() => {});
  });

  it("facets 含高价值标签计数", async () => {
    const facets = await collectTagFacets(prisma, ["skill", "memory"], 40);
    const hv = facets.find((f) => f.tag === "非常有用");
    expect(hv).toBeTruthy();
    expect(hv!.count).toBeGreaterThanOrEqual(2);
    expect(hv!.highValue).toBe(true);
  });

  it("byTag 跨实体返回 skill + memory", async () => {
    const { tag, hits } = await browseByTag(prisma, "useful", ["skill", "memory"], 40);
    expect(tag).toBe("非常有用");
    const entities = new Set(hits.map((h) => h.entity));
    expect(entities.has("skill")).toBe(true);
    expect(entities.has("memory")).toBe(true);
    expect(hits.some((h) => h.id === skillId)).toBe(true);
    expect(hits.some((h) => h.id === memoryId)).toBe(true);
  });
});
