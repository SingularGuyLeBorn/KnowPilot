/**
 * Swarm harness 增量：轨迹 JSONL + 阶段工件
 */
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { exportSwarmTraceJsonl } from "../infra/swarmTrace.js";
import { listSwarmStages, readSwarmStage, writeSwarmStage } from "../infra/swarmStages.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";

describe("swarm harness extras", () => {
  let root: string;
  const cleanupIds: { sessionId?: string; agentId?: string } = {};

  afterEach(async () => {
    const sid = cleanupIds.sessionId;
    const aid = cleanupIds.agentId;
    cleanupIds.sessionId = undefined;
    cleanupIds.agentId = undefined;
    if (sid) {
      await prisma.chatMessage.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await prisma.run.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { id: sid } }).catch(() => {});
    }
    if (aid) {
      await prisma.agent.deleteMany({ where: { id: aid } }).catch(() => {});
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("exportSwarmTraceJsonl 默认不含正文", async () => {
    root = createTempProjectDir();
    const config = createTestConfig(root);
    const agent = await prisma.agent.create({
      data: {
        name: `trace-agent-${Date.now()}`,
        model: "deepseek-v4-flash",
        systemPrompt: "test",
        tools: "native:web_search",
        tier: "sub",
      },
    });
    cleanupIds.agentId = agent.id;
    const session = await prisma.chatSession.create({
      data: {
        title: "trace-session",
        agentId: agent.id,
        model: "deepseek-v4-flash",
        status: "active",
      },
    });
    cleanupIds.sessionId = session.id;
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: "SECRET_SHOULD_NOT_APPEAR",
      },
    });

    const result = await exportSwarmTraceJsonl(prisma, config, { sessionId: session.id });
    expect(result.lines).toBeGreaterThan(2);
    expect(fs.existsSync(result.path)).toBe(true);
    const text = fs.readFileSync(result.path, "utf-8");
    expect(text).toContain('"type":"meta"');
    expect(text).toContain('"type":"session"');
    expect(text).toContain('"type":"message"');
    expect(text).not.toContain("SECRET_SHOULD_NOT_APPEAR");
  });

  it("swarm stages write/list/read 落盘 Workspace", async () => {
    root = createTempProjectDir();
    const config = createTestConfig(root);
    const wsPath = path.join(root, "workspaces", "stage-test");
    fs.mkdirSync(wsPath, { recursive: true });
    const ws = await prisma.workspace.create({
      data: {
        name: `stage-ws-${Date.now()}`,
        path: path.relative(config.projectRoot, wsPath).replace(/\\/g, "/"),
        status: "active",
      },
    });

    const written = await writeSwarmStage(prisma, config, {
      workspaceId: ws.id,
      stage: "research",
      title: "调研摘要",
      body: "## 发现\n\n- 点 A\n- 点 B\n",
      authorAgentId: "agent_test",
    });
    expect(written.stage).toBe("research");
    expect(fs.existsSync(path.join(config.projectRoot, written.relPath))).toBe(true);

    const listed = await listSwarmStages(prisma, config, { workspaceId: ws.id });
    expect(listed.some((x) => x.stage === "research")).toBe(true);

    const read = await readSwarmStage(prisma, config, { workspaceId: ws.id, stage: "research" });
    expect(read.body).toContain("点 A");
    expect(read.meta.title).toBe("调研摘要");

    await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => {});
  });
});
