/**
 * D3：实体文件写回路径消毒
 *
 * 负向：旧实现 name/slug 直进 path.join，可穿越出 content。
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createAgentSchema } from "@knowpilot/shared";
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);
const RUN = `d3-${Date.now().toString(36)}`;

afterEach(async () => {
  await prisma.agent.deleteMany({ where: { name: { contains: RUN } } }).catch(() => undefined);
  // 清理可能写出的越界文件
  const evilOutside = path.resolve(config.contentPaths.agents, "..", "..", "tmp", `pwn-${RUN}.md`);
  if (fs.existsSync(evilOutside)) fs.unlinkSync(evilOutside);
});

describe("D3 FileSync slug 消毒", () => {
  it("createAgentSchema 拒绝路径穿越 name", () => {
    const parsed = createAgentSchema.safeParse({
      name: "../evil",
      description: "x",
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("agent.create({name:'../evil'}) 拒绝且 content 外无文件", async () => {
    const name = `../evil-${RUN}`;
    const result = await services.agent.create({
      name,
      description: "d3",
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
    });
    expect(result.success).toBe(false);

    const row = await prisma.agent.findFirst({ where: { name } });
    expect(row).toBeNull();

    const contentRoot = path.resolve(config.contentPaths.agents);
    const escaped = path.resolve(contentRoot, "..", "evil-" + RUN + ".md");
    // 常见穿越落点：agents/../evil-xxx.md = content/evil-xxx.md
    expect(fs.existsSync(escaped)).toBe(false);
    const projectTmp = path.resolve(config.projectRoot, "tmp", `pwn-${RUN}.md`);
    expect(fs.existsSync(projectTmp)).toBe(false);
  });
});
